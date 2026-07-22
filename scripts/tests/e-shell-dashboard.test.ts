/**
 * Batch E — LIVE database test for Global Shell & Dashboard functions.
 *
 * server-only modules can't be imported into tsx, so the DB-backed features (notification read
 * state, global search, dashboard range queries, user preferences) are exercised by mirroring
 * their exact SQL against real Postgres; the pure helpers (dashboard-range, dashboard-layout)
 * are imported and tested directly. Asserts tenant + user scoping throughout. Two throwaway orgs;
 * everything cleaned up at the end.
 *   DATABASE_URL=... npx tsx scripts/tests/e-shell-dashboard.test.ts
 */
import { and, eq, or, ilike, gt, gte, lte, ne, isNull, desc, sql } from "drizzle-orm";
import {
  db,
  pool,
  orgsTable,
  usersTable,
  customersTable,
  productsTable,
  salesInvoicesTable,
  activityLogsTable,
  notificationReadsTable,
  userPreferencesTable,
} from "../../src/db";
import { resolveRange, rangeBuckets, isDashboardRange, DASHBOARD_RANGES } from "../../src/lib/dashboard-range";
import { normalizeLayout, DEFAULT_DASHBOARD_LAYOUT } from "../../src/lib/dashboard-layout";

let failures = 0;
function assert(name: string, cond: boolean) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}`);
  if (!cond) failures++;
}

async function main() {
  const [orgA] = await db.insert(orgsTable).values({ name: "BatchE Org A" }).returning({ id: orgsTable.id });
  const [orgB] = await db.insert(orgsTable).values({ name: "BatchE Org B" }).returning({ id: orgsTable.id });
  const [uA1] = await db.insert(usersTable).values({ orgId: orgA.id, email: `ea1-${orgA.id}@t.test`, passwordHash: "x", name: "EA One", role: "owner" }).returning({ id: usersTable.id });
  const [uA2] = await db.insert(usersTable).values({ orgId: orgA.id, email: `ea2-${orgA.id}@t.test`, passwordHash: "x", name: "EA Two", role: "staff" }).returning({ id: usersTable.id });
  const [uB] = await db.insert(usersTable).values({ orgId: orgB.id, email: `eb-${orgB.id}@t.test`, passwordHash: "x", name: "EB One", role: "owner" }).returning({ id: usersTable.id });
  const [cust] = await db.insert(customersTable).values({ orgId: orgA.id, name: "Meridian Freight Co" }).returning({ id: customersTable.id });
  const [custB] = await db.insert(customersTable).values({ orgId: orgB.id, name: "Meridian Freight Co" }).returning({ id: customersTable.id });

  // ---------- 1. Pure helpers: dashboard-range + dashboard-layout ----------
  console.log("\n== 1. Range + layout helpers ==");
  {
    const now = new Date(2026, 6, 15); // 2026-07-15
    const tm = resolveRange("this_month", now);
    assert("this_month start = 1st of month", tm.start === "2026-07-01");
    assert("this_month end = last of month", tm.end === "2026-07-31");
    assert("this_month prev window = June", tm.prevStart === "2026-06-01" && tm.prevEnd === "2026-06-30");
    const l7 = resolveRange("last_7_days", now);
    assert("last_7_days spans 7 days ending today", l7.start === "2026-07-09" && l7.end === "2026-07-15");
    assert("last_7_days uses day granularity", l7.granularity === "day" && rangeBuckets(l7).length === 7);
    const yr = resolveRange("this_year", now);
    assert("this_year = Jan–Dec, month granularity", yr.start === "2026-01-01" && yr.end === "2026-12-31" && yr.granularity === "month");
    assert("this_year buckets = 12 months", rangeBuckets(yr).length === 12);
    assert("isDashboardRange validates keys", isDashboardRange("this_month") && !isDashboardRange("bogus"));
    assert("all range keys resolve", DASHBOARD_RANGES.every((k) => !!resolveRange(k, now).start));

    const norm = normalizeLayout([{ key: "hr_snapshot", visible: false }, { key: "not_a_widget", visible: true }]);
    assert("normalizeLayout drops unknown keys", !norm.some((w) => (w.key as string) === "not_a_widget"));
    assert("normalizeLayout keeps saved visibility", norm.find((w) => w.key === "hr_snapshot")?.visible === false);
    assert("normalizeLayout appends missing widgets (complete list)", norm.length === DEFAULT_DASHBOARD_LAYOUT.length);
    assert("normalizeLayout respects saved order (hr_snapshot first)", norm[0].key === "hr_snapshot");
  }

  // ---------- data for DB-backed sections ----------
  const mkInv = (orgId: number, custId: number, num: string, status: string, date: string, total: string) =>
    db.insert(salesInvoicesTable).values({
      orgId, invoiceNumber: num, customerId: custId, status, issueDate: date, dueDate: date,
      subtotal: total, discount: "0", taxTotal: "0", total, paidAmount: "0", createdById: uA1.id,
    });
  await mkInv(orgA.id, cust.id, "BE-INV-JUL-1", "sent", "2026-07-05", "1000");
  await mkInv(orgA.id, cust.id, "BE-INV-JUL-2", "paid", "2026-07-20", "500");
  await mkInv(orgA.id, cust.id, "BE-INV-JUN-1", "sent", "2026-06-10", "800");
  await mkInv(orgA.id, cust.id, "BE-INV-DRAFT", "draft", "2026-07-08", "999"); // excluded from KPI
  await mkInv(orgB.id, custB.id, "BE-INV-OTHER", "sent", "2026-07-05", "7777"); // other org
  const [prod] = await db.insert(productsTable).values({ orgId: orgA.id, name: "Hydraulic Pump X9", sku: "HYD-X9", unitPrice: "250" }).returning({ id: productsTable.id });

  // ---------- 2. Notifications: per-user read state + tenant scope ----------
  console.log("\n== 2. Notification read state ==");
  {
    const mkAct = (orgId: number, type: string, entityType: string, entityId: number, ageMin: number) =>
      db.insert(activityLogsTable).values({ orgId, type, description: `${type} #${entityId}`, entityType, entityId, userId: uA1.id, userName: "EA One", createdAt: new Date(Date.now() - ageMin * 60000) }).returning({ id: activityLogsTable.id });
    const [a1] = await mkAct(orgA.id, "quotation.created", "quotation", 11, 30);
    const [a2] = await mkAct(orgA.id, "sales_invoice.sent", "sales_invoice", 22, 20);
    const [a3] = await mkAct(orgA.id, "client.created", "client", 33, 10);
    await mkAct(orgB.id, "quotation.created", "quotation", 99, 5); // other org

    // feed + read computation as getNotifications does (for uA1)
    const feed = async (userId: number) => {
      const rows = await db.select().from(activityLogsTable).where(eq(activityLogsTable.orgId, orgA.id)).orderBy(desc(activityLogsTable.createdAt));
      const reads = await db.select({ activityId: notificationReadsTable.activityId }).from(notificationReadsTable).where(and(eq(notificationReadsTable.orgId, orgA.id), eq(notificationReadsTable.userId, userId)));
      const [pref] = await db.select({ readAt: userPreferencesTable.notificationsReadAt }).from(userPreferencesTable).where(and(eq(userPreferencesTable.orgId, orgA.id), eq(userPreferencesTable.userId, userId)));
      const readIds = new Set(reads.map((r) => r.activityId));
      const wm = pref?.readAt ?? null;
      return rows.map((r) => ({ id: r.id, entityType: r.entityType, entityId: r.entityId, read: readIds.has(r.id) || (wm != null && r.createdAt <= wm) }));
    };

    let f = await feed(uA1.id);
    assert("orgA feed has 3 items (orgB excluded)", f.length === 3);
    assert("all unread initially", f.every((x) => !x.read));

    // mark one read
    await db.insert(notificationReadsTable).values({ orgId: orgA.id, userId: uA1.id, activityId: a2.id }).onConflictDoNothing();
    f = await feed(uA1.id);
    assert("marked item is read for uA1", f.find((x) => x.id === a2.id)?.read === true);
    assert("other items stay unread for uA1", f.filter((x) => x.id !== a2.id).every((x) => !x.read));

    // idempotent re-mark
    await db.insert(notificationReadsTable).values({ orgId: orgA.id, userId: uA1.id, activityId: a2.id }).onConflictDoNothing();
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(notificationReadsTable).where(and(eq(notificationReadsTable.orgId, orgA.id), eq(notificationReadsTable.userId, uA1.id), eq(notificationReadsTable.activityId, a2.id)));
    assert("mark-as-read is idempotent (no duplicate row)", n === 1);

    // cross-user: uA2 has no reads
    const f2 = await feed(uA2.id);
    assert("read state is per-user (uA2 sees a2 unread)", f2.find((x) => x.id === a2.id)?.read === false);

    // mark all read for uA1 via watermark upsert
    const now = new Date();
    await db.insert(userPreferencesTable).values({ orgId: orgA.id, userId: uA1.id, notificationsReadAt: now }).onConflictDoUpdate({ target: [userPreferencesTable.orgId, userPreferencesTable.userId], set: { notificationsReadAt: now } });
    f = await feed(uA1.id);
    assert("mark-all-read clears uA1 unread", f.every((x) => x.read));
    const f2b = await feed(uA2.id);
    assert("mark-all-read is per-user (uA2 still unread)", f2b.some((x) => !x.read));
    // entity mapping data present so href can be computed
    assert("feed carries entityType/entityId for open-record", f.find((x) => x.id === a1.id)?.entityType === "quotation" && f.find((x) => x.id === a1.id)?.entityId === 11);

    // unread count query (uA2, no reads/watermark) = 3
    const unread = async (userId: number) => {
      const [pref] = await db.select({ readAt: userPreferencesTable.notificationsReadAt }).from(userPreferencesTable).where(and(eq(userPreferencesTable.orgId, orgA.id), eq(userPreferencesTable.userId, userId)));
      const reads = await db.select({ activityId: notificationReadsTable.activityId }).from(notificationReadsTable).where(and(eq(notificationReadsTable.orgId, orgA.id), eq(notificationReadsTable.userId, userId)));
      const readIds = new Set(reads.map((r) => r.activityId));
      const conds = [eq(activityLogsTable.orgId, orgA.id)];
      if (pref?.readAt) conds.push(gt(activityLogsTable.createdAt, pref.readAt));
      const rows = await db.select({ id: activityLogsTable.id }).from(activityLogsTable).where(and(...conds));
      return rows.reduce((k, r) => (readIds.has(r.id) ? k : k + 1), 0);
    };
    assert("unread count = 3 for user with no reads", (await unread(uA2.id)) === 3);
    assert("unread count = 0 for user who marked all", (await unread(uA1.id)) === 0);
  }

  // ---------- 3. Global search (tenant-scoped, by number/name/sku) ----------
  console.log("\n== 3. Global search ==");
  {
    const like = "%merid%";
    const byParty = await db
      .select({ id: salesInvoicesTable.id, number: salesInvoicesTable.invoiceNumber })
      .from(salesInvoicesTable)
      .innerJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
      .where(and(eq(salesInvoicesTable.orgId, orgA.id), isNull(salesInvoicesTable.deletedAt), or(ilike(salesInvoicesTable.invoiceNumber, like), ilike(customersTable.name, like))));
    assert("search by client name finds orgA invoices only", byParty.length === 4 && byParty.every((r) => r.number.startsWith("BE-INV")));
    assert("search never returns other org's invoice", !byParty.some((r) => r.number === "BE-INV-OTHER"));

    const byNumber = await db
      .select({ id: salesInvoicesTable.id, number: salesInvoicesTable.invoiceNumber })
      .from(salesInvoicesTable)
      .innerJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
      .where(and(eq(salesInvoicesTable.orgId, orgA.id), or(ilike(salesInvoicesTable.invoiceNumber, "%jul-1%"), ilike(customersTable.name, "%jul-1%"))));
    assert("search by document number matches", byNumber.length === 1 && byNumber[0].number === "BE-INV-JUL-1");

    const bySku = await db.select({ id: productsTable.id, name: productsTable.name }).from(productsTable).where(and(eq(productsTable.orgId, orgA.id), eq(productsTable.isActive, true), or(ilike(productsTable.name, "%hyd-x9%"), ilike(productsTable.sku, "%hyd-x9%"))));
    assert("search products by SKU matches", bySku.length === 1 && bySku[0].name === "Hydraulic Pump X9");

    const other = await db
      .select({ id: salesInvoicesTable.id })
      .from(salesInvoicesTable)
      .innerJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
      .where(and(eq(salesInvoicesTable.orgId, orgB.id), or(ilike(salesInvoicesTable.invoiceNumber, like), ilike(customersTable.name, like))));
    assert("orgB search space is isolated (its own row only)", other.length === 1);
  }

  // ---------- 4. Dashboard range-scoped KPIs (mirror queries.ts) ----------
  console.log("\n== 4. Dashboard range filtering ==");
  {
    const totalBetween = async (orgId: number, start: string, end: string) => {
      const [row] = await db.select({ total: sql<string>`coalesce(sum(${salesInvoicesTable.total}),0)` }).from(salesInvoicesTable)
        .where(and(eq(salesInvoicesTable.orgId, orgId), ne(salesInvoicesTable.status, "draft"), ne(salesInvoicesTable.status, "void"), gte(salesInvoicesTable.issueDate, start), lte(salesInvoicesTable.issueDate, end)));
      return Number(row?.total ?? 0);
    };
    const jul = resolveRange("this_month", new Date(2026, 6, 15));
    const salesJul = await totalBetween(orgA.id, jul.start, jul.end);
    assert("this_month KPI = sum of non-draft July invoices (1500)", salesJul === 1500);
    const salesPrev = await totalBetween(orgA.id, jul.prevStart, jul.prevEnd);
    assert("previous-period KPI = June total (800)", salesPrev === 800);

    const lastMonth = resolveRange("last_month", new Date(2026, 6, 15));
    const salesLast = await totalBetween(orgA.id, lastMonth.start, lastMonth.end);
    assert("last_month range excludes July invoices (800)", salesLast === 800);

    assert("draft invoice excluded from KPI totals", salesJul === 1500); // 999 draft not counted
    assert("other org's July invoice never counted for orgA", (await totalBetween(orgB.id, jul.start, jul.end)) === 7777 && salesJul === 1500);

    // revenue series buckets sum correctly for the year
    const yr = resolveRange("this_year", new Date(2026, 6, 15));
    const rows = await db.select({ date: salesInvoicesTable.issueDate, total: salesInvoicesTable.total }).from(salesInvoicesTable)
      .where(and(eq(salesInvoicesTable.orgId, orgA.id), ne(salesInvoicesTable.status, "draft"), ne(salesInvoicesTable.status, "void"), gte(salesInvoicesTable.issueDate, yr.start), lte(salesInvoicesTable.issueDate, yr.end)));
    const buckets = rangeBuckets(yr).map((b) => { let s = 0; for (const r of rows) if (r.date >= b.start && r.date <= b.end) s += Number(r.total); return s; });
    assert("year series sums to full-year non-draft total (2300)", buckets.reduce((a, b) => a + b, 0) === 2300);
    assert("June bucket = 800, July bucket = 1500", buckets[5] === 800 && buckets[6] === 1500);
  }

  // ---------- 5. User preferences upsert (one row per user, scoped) ----------
  console.log("\n== 5. User preferences ==");
  {
    const upsert = (userId: number, set: Record<string, unknown>) =>
      db.insert(userPreferencesTable).values({ orgId: orgA.id, userId, ...set }).onConflictDoUpdate({ target: [userPreferencesTable.orgId, userPreferencesTable.userId], set });
    // uA1 already has a row (watermark from section 2) — upsert range onto it
    await upsert(uA1.id, { dashboardRange: "last_30_days" });
    await upsert(uA1.id, { dashboardRange: "this_year", dashboardLayout: [{ key: "kpi_sales", visible: false }] });
    const [row] = await db.select().from(userPreferencesTable).where(and(eq(userPreferencesTable.orgId, orgA.id), eq(userPreferencesTable.userId, uA1.id)));
    assert("range preference persists last value", row.dashboardRange === "this_year");
    assert("layout preference round-trips", Array.isArray(row.dashboardLayout) && (row.dashboardLayout as { key: string }[])[0].key === "kpi_sales");
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(userPreferencesTable).where(and(eq(userPreferencesTable.orgId, orgA.id), eq(userPreferencesTable.userId, uA1.id)));
    assert("exactly one preferences row per (org,user)", n === 1);

    await upsert(uA2.id, { dashboardRange: "this_quarter" });
    const [rowA2] = await db.select({ range: userPreferencesTable.dashboardRange }).from(userPreferencesTable).where(and(eq(userPreferencesTable.orgId, orgA.id), eq(userPreferencesTable.userId, uA2.id)));
    assert("preferences are per-user (uA2 independent)", rowA2.range === "this_quarter");
    assert("normalizeLayout falls back to default when unset", normalizeLayout(null).length === DEFAULT_DASHBOARD_LAYOUT.length);
  }

  // ---------- cleanup ----------
  await db.delete(notificationReadsTable).where(or(eq(notificationReadsTable.orgId, orgA.id), eq(notificationReadsTable.orgId, orgB.id)));
  await db.delete(userPreferencesTable).where(or(eq(userPreferencesTable.orgId, orgA.id), eq(userPreferencesTable.orgId, orgB.id)));
  await db.delete(activityLogsTable).where(or(eq(activityLogsTable.orgId, orgA.id), eq(activityLogsTable.orgId, orgB.id)));
  await db.delete(salesInvoicesTable).where(or(eq(salesInvoicesTable.orgId, orgA.id), eq(salesInvoicesTable.orgId, orgB.id)));
  await db.delete(productsTable).where(or(eq(productsTable.orgId, orgA.id), eq(productsTable.orgId, orgB.id)));
  await db.delete(customersTable).where(or(eq(customersTable.orgId, orgA.id), eq(customersTable.orgId, orgB.id)));
  await db.delete(usersTable).where(or(eq(usersTable.orgId, orgA.id), eq(usersTable.orgId, orgB.id)));
  await db.delete(orgsTable).where(or(eq(orgsTable.id, orgA.id), eq(orgsTable.id, orgB.id)));

  console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILED"}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
