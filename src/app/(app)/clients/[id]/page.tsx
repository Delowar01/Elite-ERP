import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, customersTable, salesInvoicesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClientForm } from "../client-form";
import { updateClientAction } from "../actions";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const clientId = Number(id);
  if (!Number.isInteger(clientId)) notFound();

  const [client] = await db
    .select()
    .from(customersTable)
    .where(and(eq(customersTable.id, clientId), eq(customersTable.orgId, session.orgId)))
    .limit(1);

  if (!client) notFound();

  const invoices = await db
    .select()
    .from(salesInvoicesTable)
    .where(and(eq(salesInvoicesTable.customerId, clientId), eq(salesInvoicesTable.orgId, session.orgId)))
    .orderBy(salesInvoicesTable.issueDate);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={client.name}
        description="Client profile"
        actions={<Badge variant={client.isActive ? "success" : "neutral"}>{client.isActive ? "Active" : "Inactive"}</Badge>}
      />

      <div className="grid grid-cols-3 gap-5">
        <Card className="col-span-2">
          <CardContent className="pt-6">
            <ClientForm client={client} action={updateClientAction.bind(null, client.id)} submitLabel="Save changes" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <p className="text-xs text-ink-faint">No invoices yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {invoices.map((inv) => (
                  <div key={inv.id} className="flex justify-between text-[13px] border-b border-line pb-2 last:border-0">
                    <span className="font-mono">{inv.invoiceNumber}</span>
                    <span className="text-ink-muted">{inv.total} SAR</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
