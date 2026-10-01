/**
 * DEV-UI-01.0 — deterministic SYNTHETIC seed for the visual-baseline database.
 *
 * Every value here is invented. Names carry "(Fictional)" / ".test" domains so no screenshot can be
 * mistaken for a real customer. Run ONLY by tests/ui-baseline/run.mjs, which sets DATABASE_URL to a
 * freshly created `devui010_test_only_seed` database and refuses anything else; this file re-checks
 * the name before writing a single row.
 *
 * Determinism: the database is created empty, so every serial id is the same on every run; every
 * timestamp the UI can display is set explicitly (never `now()`); document numbers are assigned in
 * a fixed order. The only non-deterministic value is the bcrypt salt of the owner's password hash,
 * which is never rendered.
 *
 * Org defaults (chart of accounts, sequences, presets, units, cash account, departments …) come from
 * the application's own `seedOrgDefaults` — the same function registration calls — so the baseline
 * org has exactly the shape a newly registered org has. Business rows are inserted the way the
 * existing verify suites insert fixtures (see verify/verify-statements.mts), with balanced journal
 * entries for every posted document so the finance reports render real figures.
 *
 * Run: DATABASE_URL=… UI_BASELINE_OWNER_PASSWORD=… npx tsx --conditions=react-server tests/ui-baseline/seed.mts
 */
import { db, pool } from "../../src/db";
import { orgsTable } from "../../src/db/schema/orgs";
import { usersTable } from "../../src/db/schema/users";
import { seedOrgDefaults } from "../../src/lib/seed-org";
import { hashPassword } from "../../src/lib/auth";

const target = new URL(process.env.DATABASE_URL ?? "");
if (target.pathname !== "/devui010_test_only_seed" || !["127.0.0.1", "localhost"].includes(target.hostname)) {
  console.error("seed.mts: refusing — DATABASE_URL is not the local devui010_test_only_seed database");
  process.exit(2);
}
const ownerPassword = process.env.UI_BASELINE_OWNER_PASSWORD;
if (!ownerPassword) {
  console.error("seed.mts: UI_BASELINE_OWNER_PASSWORD is not set");
  process.exit(2);
}

const OWNER_EMAIL = "owner@visual-baseline.test";

const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params)).rows[0];

// A fixed instant for every created_at/updated_at the UI might show. Documents get their own dates.
const TS = (d: string, hm = "09:00") => `${d} ${hm}:00`;

// ---------------------------------------------------------------- org + owner (application code path)
const passwordHash = await hashPassword(ownerPassword);
const { orgId, userId } = await db.transaction(async (tx) => {
  const [org] = await tx
    .insert(orgsTable)
    .values({
      name: "TEST-ONLY Visual Baseline Trading Co.",
      country: "Saudi Arabia",
      currency: "SAR",
      baseCurrencyConfirmedAt: new Date("2026-01-04T08:00:00Z"),
      address: "100 Example Street, Riyadh (Fictional)",
      phone: "+966 11 000 0000",
      email: "accounts@visual-baseline.test",
      vatNumber: "300000000000003",
      industry: "Trading",
    })
    .returning();
  const [user] = await tx
    .insert(usersTable)
    .values({ orgId: org.id, email: OWNER_EMAIL, passwordHash, name: "Baseline Owner", role: "owner" })
    .returning();
  await seedOrgDefaults(tx, org.id, "Saudi Arabia");
  return { orgId: org.id, userId: user.id };
});

await q("update orgs set created_at=$2, updated_at=$2 where id=$1", [orgId, TS("2026-01-04")]).catch(() => undefined);
await q("update users set created_at=$2 where id=$1", [userId, TS("2026-01-04")]).catch(() => undefined);

const accounts = new Map<string, number>(
  (await q("select id, code from accounts where org_id=$1", [orgId])).rows.map((r) => [r.code as string, r.id as number]),
);
const acc = (code: string) => {
  const id = accounts.get(code);
  if (!id) throw new Error(`seed: account ${code} missing from the default chart`);
  return id;
};
const cashBank = (await one("select id from bank_accounts where org_id=$1 order by id limit 1", [orgId])).id as number;

// ---------------------------------------------------------------- master data
const customers: Array<[string, string, string, string]> = [
  ["Al Noor Contracting (Fictional)", "business", "procurement@alnoor.test", "Riyadh"],
  ["Blue Harbor Events (Fictional)", "business", "events@blueharbor.test", "Jeddah"],
  ["Cedar Line Hospitality (Fictional)", "business", "finance@cedarline.test", "Dammam"],
  ["Desert Rose Exhibitions (Fictional)", "business", "hello@desertrose.test", "Riyadh"],
  ["Omar Example (Fictional)", "individual", "omar@example.test", "Khobar"],
  ["Sara Sample (Fictional)", "individual", "sara@example.test", "Riyadh"],
];
const customerIds: number[] = [];
for (const [i, [name, type, email, city]] of customers.entries()) {
  const r = await one(
    `insert into customers (org_id,name,client_type,email,phone,city,country_code,vat_number,created_at,updated_at)
     values ($1,$2,$3,$4,$5,$6,'SA',$7,$8,$8) returning id`,
    [orgId, name, type, email, `+966 50 000 00${10 + i}`, city, type === "business" ? `3000000000${10 + i}003` : null, TS("2026-02-01")],
  );
  customerIds.push(r.id);
}

const vendors = ["Gulf Paper Supply (Fictional)", "Northwind Print House (Fictional)", "Atlas Logistics (Fictional)", "Summit Booth Builders (Fictional)"];
const vendorIds: number[] = [];
for (const [i, name] of vendors.entries()) {
  const r = await one(
    "insert into vendors (org_id,name,email,phone,vat_number,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$6) returning id",
    [orgId, name, `orders${i}@vendor.test`, `+966 55 000 00${20 + i}`, `3100000000${20 + i}003`, TS("2026-02-01")],
  );
  vendorIds.push(r.id);
}

const products: Array<[string, string, string, number, number, number, number]> = [
  // sku, name, unit, price, cost, on hand, reorder
  ["BTH-3X3", "Exhibition booth 3x3 m", "pcs", 12500, 8200, 6, 2],
  ["BTH-6X3", "Exhibition booth 6x3 m", "pcs", 21800, 14300, 3, 2],
  ["LED-WALL", "LED video wall (per day)", "pcs", 4200, 2600, 4, 1],
  ["CARPET-SQM", "Event carpet", "pcs", 38.5, 21, 420, 100],
  ["BANNER-RU", "Roll-up banner", "pcs", 290, 140, 25, 10],
  ["DESIGN-HR", "Design services", "hr", 350, 0, 0, 0],
  ["FURN-SET", "Lounge furniture set", "pcs", 1850, 1100, 1, 2],
  ["PRINT-A4", "Brochure print run (1,000)", "pcs", 760.25, 410, 12, 5],
];
const productIds: number[] = [];
for (const [sku, name, unit, price, cost, onHand, reorder] of products) {
  const r = await one(
    `insert into products (org_id,sku,name,unit,unit_price,cost_price,tax_rate_percent,quantity_on_hand,reorder_level,created_at,updated_at)
     values ($1,$2,$3,$4,$5,$6,15,$7,$8,$9,$9) returning id`,
    [orgId, sku, name, unit, price, cost, onHand, reorder, TS("2026-02-02")],
  );
  productIds.push(r.id);
}

// ---------------------------------------------------------------- HR
const departments = new Map<string, number>(
  (await q("select id, name from departments where org_id=$1", [orgId])).rows.map((r) => [r.name as string, r.id as number]),
);
const deptIds = [...departments.values()];
const dept = (i: number) => (deptIds.length ? deptIds[i % deptIds.length] : null);
const employees: Array<[string, string, string, string, number]> = [
  ["EMP-001", "Khalid Example (Fictional)", "Operations Manager", "full_time", 18000],
  ["EMP-002", "Layla Sample (Fictional)", "Senior Designer", "full_time", 14500],
  ["EMP-003", "Yusuf Placeholder (Fictional)", "Project Coordinator", "full_time", 11200],
  ["EMP-004", "Mona Testcase (Fictional)", "Accountant", "full_time", 12800],
  ["EMP-005", "Faisal Dummy (Fictional)", "Site Technician", "contract", 7600],
  ["EMP-006", "Huda Mockup (Fictional)", "Sales Executive", "part_time", 6400],
];
const employeeIds: number[] = [];
for (const [i, [code, name, designation, type, basic]] of employees.entries()) {
  const r = await one(
    `insert into employees (org_id,employee_code,name,email,phone,department_id,designation,employment_type,join_date,status,created_at,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$10) returning id`,
    [orgId, code, name, `${code.toLowerCase()}@visual-baseline.test`, `+966 54 000 00${30 + i}`, dept(i), designation, type, `2025-0${(i % 9) + 1}-01`, TS("2026-02-03")],
  );
  employeeIds.push(r.id);
  await q(
    "insert into salary_structures (org_id,employee_id,basic_salary,allowances,deductions,effective_from,created_at) values ($1,$2,$3,$4,$5,'2026-01-01',$6)",
    [orgId, r.id, basic, Math.round(basic * 0.25), Math.round(basic * 0.1), TS("2026-02-03")],
  );
}
for (const [i, d] of ["2026-06-10", "2026-06-11", "2026-06-12"].entries()) {
  for (const [j, e] of employeeIds.entries()) {
    const status = (i + j) % 7 === 3 ? "late" : (i + j) % 11 === 5 ? "absent" : "present";
    await q(
      "insert into attendance_records (org_id,employee_id,date,check_in,check_out,status,created_at) values ($1,$2,$3,$4,$5,$6,$7)",
      [orgId, e, d, status === "absent" ? null : `${d} ${status === "late" ? "09:40" : "08:0" + j}:00`, status === "absent" ? null : `${d} 17:0${j}:00`, status, TS(d, "18:00")],
    );
  }
}
await q(
  `insert into leave_requests (org_id,employee_id,type,start_date,end_date,reason,status,approved_by_id,decided_at,created_at) values
   ($1,$2,'annual','2026-06-22','2026-06-26','Family travel (synthetic)','approved',$4,$5,$5),
   ($1,$3,'sick','2026-06-16','2026-06-17','Medical appointment (synthetic)','pending',null,null,$6)`,
  [orgId, employeeIds[1], employeeIds[4], userId, TS("2026-06-08"), TS("2026-06-14")],
);
const payroll = await one(
  "insert into payroll_runs (org_id,period_month,period_year,status,processed_at,created_by_id,created_at) values ($1,5,2026,'processed',$2,$3,$2) returning id",
  [orgId, TS("2026-05-28"), userId],
);
let payrollNet = 0;
for (const [i, e] of employeeIds.entries()) {
  const basic = employees[i][4];
  const allow = Math.round(basic * 0.25);
  const ded = Math.round(basic * 0.1);
  payrollNet += basic + allow - ded;
  await q(
    "insert into payslips (payroll_run_id,employee_id,basic_salary,allowances,deductions,gross_pay,net_pay,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [payroll.id, e, basic, allow, ded, basic + allow, basic + allow - ded, TS("2026-05-28")],
  );
}

// ---------------------------------------------------------------- projects
const projects: Array<[string, number, string, string, string, number]> = [
  ["Riyadh Tech Expo 2026 booth", 0, "active", "2026-04-01", "2026-07-15", 185000],
  ["Jeddah Hospitality Summit", 1, "planned", "2026-07-01", "2026-09-30", 92000],
  ["Annual brand refresh", 3, "completed", "2026-01-10", "2026-03-31", 40000],
];
const projectIds: number[] = [];
for (const [name, ci, status, start, end, budget] of projects) {
  const r = await one(
    "insert into projects (org_id,name,client_id,status,start_date,end_date,budget,description,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) returning id",
    [orgId, name, customerIds[ci], status, start, end, budget, "Synthetic project for the visual baseline.", TS("2026-03-01")],
  );
  projectIds.push(r.id);
}
const tasks: Array<[string, string, string, number, string]> = [
  ["Finalize booth floor plan", "done", "high", 1, "2026-05-10"],
  ["Order LED wall", "done", "medium", 0, "2026-05-20"],
  ["Print brochures", "in_progress", "medium", 1, "2026-06-20"],
  ["Book freight to venue", "in_progress", "high", 2, "2026-06-25"],
  ["Install carpet and lighting", "todo", "high", 4, "2026-07-08"],
  ["Staff rota for show days", "todo", "low", 2, "2026-07-01"],
  ["Venue power approval", "blocked", "high", 0, "2026-06-18"],
  ["Post-show teardown", "todo", "medium", 4, "2026-07-16"],
];
for (const [title, status, priority, emp, due] of tasks) {
  await q(
    "insert into tasks (org_id,project_id,title,assignee_id,status,priority,due_date,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$8)",
    [orgId, projectIds[0], title, employeeIds[emp], status, priority, due, TS("2026-04-02")],
  );
}

// ---------------------------------------------------------------- documents
type Line = [number, number]; // product index, quantity
const lineValues = (lines: Line[]) =>
  lines.map(([pi, qty]) => {
    const price = products[pi][3];
    const total = Math.round(price * qty * 100) / 100;
    return { productId: productIds[pi], description: products[pi][1], unit: products[pi][2], qty, price, total };
  });
const totals = (lines: ReturnType<typeof lineValues>) => {
  const subtotal = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;
  const tax = Math.round(subtotal * 0.15 * 100) / 100;
  return { subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100 };
};

async function postEntry(date: string, memo: string, sourceType: string, sourceId: number | null, lines: Array<[string, number, number]>, projectId: number | null = null) {
  const je = await one(
    "insert into journal_entries (org_id,entry_date,memo,source_type,source_id,project_id,created_by_id,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
    [orgId, date, memo, sourceType, sourceId, projectId, userId, TS(date, "10:00")],
  );
  for (const [code, debit, credit] of lines) {
    await q("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,$3,$4)", [je.id, acc(code), debit, credit]);
  }
}

async function nextNumber(type: string): Promise<string> {
  const s = await one("select prefix, next_number, padding from document_sequences where org_id=$1 and document_type=$2", [orgId, type]);
  await q("update document_sequences set next_number=next_number+1 where org_id=$1 and document_type=$2", [orgId, type]);
  return `${s.prefix}${String(s.next_number).padStart(s.padding, "0")}`;
}

// Quotations
const quotations: Array<[number, string, string, Line[], number | null]> = [
  [0, "accepted", "2026-04-02", [[0, 2], [2, 3]], 0],
  [1, "sent", "2026-05-18", [[1, 1], [4, 6]], 1],
  [2, "draft", "2026-06-05", [[5, 24]], null],
  [3, "rejected", "2026-05-02", [[6, 2], [3, 60]], null],
  [4, "expired", "2026-03-11", [[4, 2]], null],
];
for (const [ci, status, date, ls, pj] of quotations) {
  const lines = lineValues(ls);
  const t = totals(lines);
  const number = await nextNumber("quotation");
  const r = await one(
    `insert into quotations (org_id,quotation_number,customer_id,project_id,status,issue_date,valid_until,subtotal,tax_total,total,currency,exchange_rate,base_total,base_tax_amount,created_by_id,created_at,updated_at)
     values ($1,$2,$3,$4,$5,$6,($6::date + 30),$7,$8,$9,'SAR',1,$9,$8,$10,$11,$11) returning id`,
    [orgId, number, customerIds[ci], pj === null ? null : projectIds[pj], status, date, t.subtotal, t.tax, t.total, userId, TS(date, "11:00")],
  );
  for (const l of lines) {
    await q(
      "insert into quotation_items (quotation_id,product_id,unit,description,quantity,unit_price,tax_rate_percent,line_total) values ($1,$2,$3,$4,$5,$6,15,$7)",
      [r.id, l.productId, l.unit, l.description, l.qty, l.price, l.total],
    );
  }
}

// Sales invoices: status, issue date, lines, project, paid fraction
const invoices: Array<[number, string, string, Line[], number | null, number]> = [
  [0, "paid", "2026-04-15", [[0, 2], [2, 3]], 0, 1],
  [1, "partially_paid", "2026-05-03", [[1, 1], [4, 6], [3, 40]], 1, 0.4],
  [2, "sent", "2026-05-27", [[5, 30], [7, 2]], null, 0],
  [3, "sent", "2026-06-04", [[6, 1], [4, 3]], null, 0],
  [0, "paid", "2026-06-09", [[3, 120], [5, 12]], 0, 1],
  [4, "draft", "2026-06-12", [[4, 1]], null, 0],
  [5, "sent", "2026-03-20", [[7, 1]], null, 0], // overdue by the frozen date
  [2, "void", "2026-05-12", [[2, 1]], null, 0],
];
for (const [ci, status, date, ls, pj, paidFraction] of invoices) {
  const lines = lineValues(ls);
  const t = totals(lines);
  const paid = Math.round(t.total * paidFraction * 100) / 100;
  const number = await nextNumber("sales_invoice");
  const r = await one(
    `insert into sales_invoices (org_id,invoice_number,customer_id,project_id,status,issue_date,due_date,subtotal,tax_total,total,paid_amount,currency,exchange_rate,base_total,base_tax_amount,base_paid_amount,created_by_id,invoice_type,created_at,updated_at)
     values ($1,$2,$3,$4,$5,$6,($6::date + 30),$7,$8,$9,$10,'SAR',1,$9,$8,$10,$11,'standard',$12,$12) returning id`,
    [orgId, number, customerIds[ci], pj === null ? null : projectIds[pj], status, date, t.subtotal, t.tax, t.total, paid, userId, TS(date, "12:00")],
  );
  for (const l of lines) {
    await q(
      "insert into sales_invoice_items (invoice_id,product_id,unit,description,quantity,unit_price,tax_rate_percent,line_total) values ($1,$2,$3,$4,$5,$6,15,$7)",
      [r.id, l.productId, l.unit, l.description, l.qty, l.price, l.total],
    );
  }
  if (status !== "draft" && status !== "void") {
    await postEntry(date, `Invoice ${number}`, "sales_invoice", r.id, [["1100", t.total, 0], ["4000", 0, t.subtotal], ["2100", 0, t.tax]], pj === null ? null : projectIds[pj]);
  }
  if (paid > 0) {
    const payDate = status === "paid" ? date : "2026-05-20";
    const p = await one(
      `insert into payments (org_id,direction,bank_account_id,amount,currency,exchange_rate,base_amount,payment_date,method,reference,sales_invoice_id,created_by_id,created_at)
       values ($1,'in',$2,$3,'SAR',1,$3,$4,'bank_transfer',$5,$6,$7,$8) returning id`,
      [orgId, cashBank, paid, payDate, `TRX-${number}`, r.id, userId, TS(payDate, "15:00")],
    );
    await postEntry(payDate, `Payment for ${number}`, "payment", p.id, [["1000", paid, 0], ["1100", 0, paid]]);
  }
}

// Purchase orders
const purchaseOrders: Array<[number, string, string, Line[], number]> = [
  [3, "received", "2026-04-05", [[0, 2]], 1],
  [1, "ordered", "2026-05-25", [[7, 4]], 0],
  [0, "draft", "2026-06-11", [[3, 200]], 0],
];
for (const [vi, status, date, ls, paidFraction] of purchaseOrders) {
  const lines = lineValues(ls).map((l, i) => {
    const cost = products[ls[i][0]][4];
    return { ...l, price: cost, total: Math.round(cost * l.qty * 100) / 100 };
  });
  const t = totals(lines);
  const paid = Math.round(t.total * paidFraction * 100) / 100;
  const number = await nextNumber("purchase_order");
  const r = await one(
    `insert into purchase_orders (org_id,po_number,vendor_id,status,order_date,expected_date,subtotal,tax_total,total,paid_amount,currency,exchange_rate,base_total,base_tax_amount,base_paid_amount,created_by_id,created_at,updated_at)
     values ($1,$2,$3,$4,$5,($5::date + 14),$6,$7,$8,$9,'SAR',1,$8,$7,$9,$10,$11,$11) returning id`,
    [orgId, number, vendorIds[vi], status, date, t.subtotal, t.tax, t.total, paid, userId, TS(date, "13:00")],
  );
  for (const l of lines) {
    await q(
      "insert into purchase_order_items (purchase_order_id,product_id,unit,description,quantity,unit_cost,tax_rate_percent,line_total) values ($1,$2,$3,$4,$5,$6,15,$7)",
      [r.id, l.productId, l.unit, l.description, l.qty, l.price, l.total],
    ).catch(async (e) => {
      throw new Error(`seed: purchase_order_items insert failed (${e.message})`);
    });
  }
  if (status !== "draft") {
    await postEntry(date, `Purchase order ${number}`, "purchase_order", r.id, [["1200", t.subtotal, 0], ["2100", t.tax, 0], ["2000", 0, t.total]]);
  }
  if (paid > 0) {
    const p = await one(
      `insert into payments (org_id,direction,bank_account_id,amount,currency,exchange_rate,base_amount,payment_date,method,reference,purchase_order_id,created_by_id,created_at)
       values ($1,'out',$2,$3,'SAR',1,$3,$4,'bank_transfer',$5,$6,$7,$8) returning id`,
      [orgId, cashBank, paid, "2026-04-20", `OUT-${number}`, r.id, userId, TS("2026-04-20", "15:00")],
    );
    await postEntry("2026-04-20", `Payment for ${number}`, "payment", p.id, [["2000", paid, 0], ["1000", 0, paid]]);
  }
}

// Owner capital and the May payroll, so the balance sheet and cash position are not trivially zero.
await postEntry("2026-01-05", "Owner capital contribution", "manual", null, [["1000", 250000, 0], ["3000", 0, 250000]]);
await postEntry("2026-05-28", "Payroll May 2026", "payroll_run", payroll.id, [["5200", payrollNet, 0], ["1000", 0, payrollNet]]);

// ---------------------------------------------------------------- summary (counts only)
const counts = (
  await q(
    `select (select count(*) from customers where org_id=$1) customers, (select count(*) from vendors where org_id=$1) vendors,
            (select count(*) from products where org_id=$1) products, (select count(*) from employees where org_id=$1) employees,
            (select count(*) from projects where org_id=$1) projects, (select count(*) from tasks where org_id=$1) tasks,
            (select count(*) from quotations where org_id=$1) quotations, (select count(*) from sales_invoices where org_id=$1) invoices,
            (select count(*) from purchase_orders where org_id=$1) purchase_orders, (select count(*) from payments where org_id=$1) payments,
            (select count(*) from journal_entries where org_id=$1) journal_entries`,
    [orgId],
  )
).rows[0];
console.log(`seed: org ${orgId}, owner ${userId}; ${JSON.stringify(counts)}`);
await pool.end();
