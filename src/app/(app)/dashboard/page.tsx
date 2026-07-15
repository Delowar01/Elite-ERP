import { count, eq } from "drizzle-orm";
import { Users, Building2, Package, Receipt } from "lucide-react";
import { db, customersTable, vendorsTable, productsTable, salesInvoicesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { SummaryCard } from "@/components/ui/summary-card";

async function countFor(orgId: number, table: typeof customersTable | typeof vendorsTable | typeof productsTable | typeof salesInvoicesTable) {
  const [row] = await db.select({ n: count() }).from(table).where(eq(table.orgId, orgId));
  return row?.n ?? 0;
}

export default async function DashboardPage() {
  const session = await requireSession();

  const [clients, vendors, products, invoices] = await Promise.all([
    countFor(session.orgId, customersTable),
    countFor(session.orgId, vendorsTable),
    countFor(session.orgId, productsTable),
    countFor(session.orgId, salesInvoicesTable),
  ]);

  const kpis = [
    { label: "Clients", value: clients, icon: Users, accent: "var(--brand-orange)" },
    { label: "Vendors", value: vendors, icon: Building2, accent: "var(--info)" },
    { label: "Products", value: products, icon: Package, accent: "var(--success)" },
    { label: "Sales invoices", value: invoices, icon: Receipt, accent: "var(--warning)" },
  ];

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-extrabold">Dashboard</h1>
        <p className="text-ink-muted text-sm mt-1">Welcome back, {session.name.split(" ")[0]}.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        {kpis.map((k, i) => (
          <SummaryCard key={k.label} label={k.label} value={k.value} icon={k.icon} accent={k.accent} delay={i * 0.04} />
        ))}
      </div>

      <Card className="animate-fade-up" style={{ animationDelay: "0.2s" }}>
        <CardContent className="pt-5 text-sm text-ink-muted">
          More KPIs (sales trend, net position, headcount, pending approvals) light up as each module ships. Start by
          adding a client, a product, and creating your first quotation.
        </CardContent>
      </Card>
    </div>
  );
}
