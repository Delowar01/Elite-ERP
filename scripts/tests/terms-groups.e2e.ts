// E2E for "Multiple Terms Groups in One Document".
// Exercises the real shared helpers + a real DB round-trip (master group ↔ document snapshot)
// following the user's exact 10-step flow. Run: npx tsx scripts/tests/terms-groups.e2e.ts
import { eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { orgsTable, usersTable, customersTable, quotationsTable, termsConditionsGroupsTable } from "../../src/db/schema";
import {
  splitGroupTerms,
  joinGroupTerms,
  normalizeDocumentTerms,
  type DocumentTerm,
} from "../../src/app/(app)/sales/_shared/document-terms";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
// Numbers = 1-based position in the list (what the UI renders).
const numbering = (terms: DocumentTerm[]) => terms.map((_, i) => i + 1);
// Reorder/swap mirror the editor helpers exactly.
function reorder<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m);
  return next;
}

async function main() {
  console.log("Terms Groups E2E — exact 10-step flow\n");

  // ---- pure-helper unit checks ----
  check("splitGroupTerms strips leading numbering + blanks", JSON.stringify(splitGroupTerms("1. Alpha\n\n2) Beta\n  Gamma  ")) === JSON.stringify(["Alpha", "Beta", "Gamma"]));
  check("joinGroupTerms round-trips", joinGroupTerms(["A", "", " B "]) === "A\nB");
  check("normalizeDocumentTerms drops empty + coerces", normalizeDocumentTerms([{ text: " x ", groupId: 3, groupName: "G" }, { text: "", groupId: null, groupName: null }]).length === 1);

  // Pick a real org that actually has both a user and a customer (to satisfy FKs).
  const candidates = await db.select().from(customersTable).limit(500);
  let org: typeof orgsTable.$inferSelect | undefined;
  let user: typeof usersTable.$inferSelect | undefined;
  let customer: typeof customersTable.$inferSelect | undefined;
  for (const c of candidates) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.orgId, c.orgId)).limit(1);
    if (u) {
      const [o] = await db.select().from(orgsTable).where(eq(orgsTable.id, c.orgId)).limit(1);
      org = o; user = u; customer = c;
      break;
    }
  }
  if (!org || !user || !customer) throw new Error("no org with both a user and a customer");
  console.log(`  (using org #${org.id})`);

  const created = { groupA: 0, groupB: 0, quotation: 0 };
  try {
    // ---- Step 1: Group A with 10 terms (master, stored structured — one includes multiline text) ----
    const aTerms = Array.from({ length: 10 }, (_, i) => (i === 2 ? "Group A term 3\nsecond line of term 3" : `Group A term ${i + 1}`));
    const [gA] = await db.insert(termsConditionsGroupsTable).values({
      orgId: org.id, name: "TEST Group A", documentType: null, terms: aTerms, isDefault: false,
    }).returning();
    created.groupA = gA.id;
    check("Group A saved with 10 structured terms", gA.terms.length === 10);
    check("A multiline term keeps its newline in storage", gA.terms[2].includes("\n"));

    // ---- Step 2: Group B with 8 terms ----
    const bTerms = Array.from({ length: 8 }, (_, i) => `Group B term ${i + 1}`);
    const [gB] = await db.insert(termsConditionsGroupsTable).values({
      orgId: org.id, name: "TEST Group B", documentType: null, terms: bTerms, isDefault: false,
    }).returning();
    created.groupB = gB.id;
    check("Group B saved with 8 structured terms", gB.terms.length === 8);

    // ---- Build the document terms by APPENDING each group (never replacing) ----
    let docTerms: DocumentTerm[] = [];
    const appendGroup = (g: typeof gA) => {
      const added = g.terms.map((text) => ({ text, groupId: g.id, groupName: g.name }));
      docTerms = [...docTerms, ...added];
    };
    appendGroup(gA);
    appendGroup(gB);

    // ---- Step 3: numbering is 1–18 ----
    check("Appending A then B yields 18 terms", docTerms.length === 18);
    check("Numbering is exactly 1–18", JSON.stringify(numbering(docTerms)) === JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)));
    check("Append did not replace (both groups present)", docTerms.some((t) => t.groupId === gA.id) && docTerms.some((t) => t.groupId === gB.id));

    // ---- Step 4 + 5: one individual term becomes number 19 ----
    docTerms = [...docTerms, { text: "Individual document-only term", groupId: null, groupName: null }];
    check("Individual term appended", docTerms.length === 19);
    check("Individual term is number 19", numbering(docTerms).at(-1) === 19 && docTerms[18].groupId === null);

    // ---- Step 6: edit a term + reorder (move the individual term to the top) ----
    docTerms = docTerms.map((t, i) => (i === 0 ? { ...t, text: "EDITED first term" } : t));
    docTerms = reorder(docTerms, 18, 0);
    // ---- Step 7: numbering auto-updates (still 1–19, individual now #1) ----
    check("Reorder keeps continuous 1–19", JSON.stringify(numbering(docTerms)) === JSON.stringify(Array.from({ length: 19 }, (_, i) => i + 1)));
    check("Edited/reordered term reflects change", docTerms[0].text === "Individual document-only term" && docTerms[1].text === "EDITED first term");

    // ---- Step 8: save the document (snapshot into jsonb `terms`) ----
    const snapshot = normalizeDocumentTerms(docTerms);
    const [quo] = await db.insert(quotationsTable).values({
      orgId: org.id, quotationNumber: `TEST-TERMS-${Date.now()}`, customerId: customer.id,
      status: "draft", issueDate: "2026-07-28", subtotal: "0", taxTotal: "0", total: "0",
      discount: "0", createdById: user.id, terms: snapshot,
    }).returning();
    created.quotation = quo.id;

    // ---- Step 9: refresh (re-read) → all terms/edits/order persist ----
    const [reloaded] = await db.select().from(quotationsTable).where(eq(quotationsTable.id, quo.id));
    const persisted = reloaded.terms ?? [];
    check("Saved document persists 19 terms", persisted.length === 19);
    check("Order/edits persist across reload", persisted[0].text === "Individual document-only term" && persisted[1].text === "EDITED first term");
    check("Group tags persist on snapshot", persisted[1].groupId === gA.id && persisted.filter((t) => t.groupId === gB.id).length === 8);
    check("Multiline term persists in the saved document", persisted.some((t) => t.text.includes("\n") && t.text.includes("second line of term 3")));

    // ---- Step 10: editing the MASTER group must NOT change the saved document ----
    await db.update(termsConditionsGroupsTable)
      .set({ terms: ["Group A COMPLETELY REWRITTEN"] })
      .where(eq(termsConditionsGroupsTable.id, gA.id));
    const [afterMasterEdit] = await db.select().from(quotationsTable).where(eq(quotationsTable.id, quo.id));
    const stillPersisted = afterMasterEdit.terms ?? [];
    check("Master edit does not touch saved document (snapshot independence)", stillPersisted.length === 19 && stillPersisted.every((t) => !t.text.includes("REWRITTEN")));

    // ---- remove-group option (2): drop reference, keep terms ----
    const keepTerms = stillPersisted.map((t) => (t.groupId === gB.id ? { ...t, groupId: null, groupName: null } : t));
    check("Remove-group 'keep terms' retains count, clears tag", keepTerms.length === 19 && keepTerms.filter((t) => t.groupId === gB.id).length === 0);
    // ---- remove-group option (1): drop group AND its terms ----
    const dropAll = stillPersisted.filter((t) => t.groupId !== gB.id);
    check("Remove-group 'remove terms' drops the 8 B terms", dropAll.length === 11);
  } finally {
    // Clean up test rows.
    if (created.quotation) await db.delete(quotationsTable).where(eq(quotationsTable.id, created.quotation));
    if (created.groupA) await db.delete(termsConditionsGroupsTable).where(eq(termsConditionsGroupsTable.id, created.groupA));
    if (created.groupB) await db.delete(termsConditionsGroupsTable).where(eq(termsConditionsGroupsTable.id, created.groupB));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
