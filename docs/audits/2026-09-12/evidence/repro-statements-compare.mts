/**
 * AUDIT REPRODUCTION part 2 — compare the real `getStatement` against the real ledger.
 *
 * Reads the fixture written by repro-statements-reversal.mjs (which drove recordPaymentAction and
 * reversePaymentAction over the wire with a genuine owner session) and asks the production
 * `getStatement` what it reports. Nothing is recomputed here: the expected figure comes from the
 * journal lines themselves.
 *
 * Run: npx tsx --env-file-if-exists=.env --conditions=react-server <this file>
 */
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { getStatement } from "../../../../src/lib/statements";
import { toCsv } from "../../../../src/lib/report-export";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const fx = JSON.parse(await readFile("docs/audits/2026-09-12/evidence/repro-statements-fixture.json", "utf8"));
const org: number = fx.org;
const out: string[] = [];
const say = (s: string) => { console.log(s); out.push(s); };

/** Control-account balance for one party, straight from the ledger — the number a statement must agree with. */
async function ledgerBalance(partyId: number, kind: "client" | "vendor", upto: string): Promise<number> {
  const code = kind === "client" ? "1100" : "2000";
  const col = kind === "client" ? "s.customer_id" : "po.vendor_id";
  const join = kind === "client"
    ? `left join sales_invoices s on je.source_type='sales_invoice' and je.source_id=s.id
       left join payments p on je.source_type in ('payment','payment_reversal') and je.source_id=p.id
       left join sales_invoices s2 on p.sales_invoice_id=s2.id`
    : `left join purchase_orders po on je.source_type='purchase_order' and je.source_id=po.id
       left join payments p on je.source_type in ('payment','payment_reversal') and je.source_id=p.id
       left join purchase_orders po2 on p.purchase_order_id=po2.id`;
  const partyExpr = kind === "client" ? "coalesce(s.customer_id, s2.customer_id)" : "coalesce(po.vendor_id, po2.vendor_id)";
  const sign = kind === "client" ? "sum(jl.debit)-sum(jl.credit)" : "sum(jl.credit)-sum(jl.debit)";
  const q = `select coalesce(${sign},0)::float as bal
    from journal_entries je
    join journal_lines jl on jl.journal_entry_id=je.id
    join accounts a on a.id=jl.account_id
    ${join}
    where je.org_id=$1 and a.code='${code}' and je.entry_date<=$3 and ${partyExpr}=$2`;
  return (await pool.query(q, [org, partyId, upto])).rows[0].bal as number;
}

say(`AUDIT REPRODUCTION — getStatement vs ledger, org ${org}`);
say(`Ledger control balances for the whole org: ${fx.control.map((c: any) => `${c.code}=${c.bal}`).join("  ")}`);
say("");

for (const [name, sc] of Object.entries(fx.scenarios) as [string, any][]) {
  const st = await getStatement(org, sc.kind, sc.partyId, { from: sc.from, to: sc.to });
  const led = await ledgerBalance(sc.partyId, sc.kind, sc.to);
  say(`── Scenario ${name} — ${sc.kind} party ${sc.partyId}, period ${sc.from}..${sc.to}${sc.note ? ` (${sc.note})` : ""}`);
  if (!st) { say("   getStatement returned NULL"); continue; }
  say(`   rows returned        : ${st.lines.length}`);
  for (const l of st.lines) say(`     · ${l.date}  ${l.docType.padEnd(16)} ${String(l.number).padEnd(16)} Dr ${l.debit}  Cr ${l.credit}  bal ${l.running}`);
  say(`   opening balance      : ${st.opening}`);
  say(`   closing balance      : ${st.closing}`);
  say(`   LEDGER balance @ ${sc.to}: ${led}`);
  const agree = Math.abs(Number(st.closing) - led) < 0.005;
  say(`   ${agree ? "AGREE" : "DISAGREE  <-- statement does not reconcile to the ledger"}   (difference ${(Number(st.closing) - led).toFixed(3)})`);
  const hasRev = st.lines.some((l) => /reversal/i.test(l.docTypeLabel ?? "") || /reversal/i.test(l.docType ?? ""));
  say(`   a reversal line present in the statement? ${hasRev ? "yes" : "NO"}`);
  // exported artefact — the customer-facing form of the same data
  const csv = toCsv(
    [{ key: "date", label: "Date" }, { key: "docTypeLabel", label: "Type" }, { key: "number", label: "Number" },
     { key: "debit", label: "Debit" }, { key: "credit", label: "Credit" }, { key: "running", label: "Balance" }] as any,
    st.lines as any,
  );
  say(`   exported CSV rows    : ${csv.trim().split("\n").length - 1}`);
  say("");
}
await pool.end();
const { writeFile } = await import("node:fs/promises");
await writeFile("docs/audits/2026-09-12/evidence/repro-statements-result.txt", out.join("\n") + "\n");
