import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, vendorsTable, purchaseOrdersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VendorForm } from "../vendor-form";
import { updateVendorAction } from "../actions";
import { VendorRecordActions } from "../vendor-record-actions";

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const vendorId = Number(id);
  if (!Number.isInteger(vendorId)) notFound();

  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(and(eq(vendorsTable.id, vendorId), tenantScope(session.orgId, vendorsTable, { includeArchived: true })))
    .limit(1);

  if (!vendor) notFound();

  const pos = await db
    .select()
    .from(purchaseOrdersTable)
    .where(and(eq(purchaseOrdersTable.vendorId, vendorId), eq(purchaseOrdersTable.orgId, session.orgId)))
    .orderBy(purchaseOrdersTable.orderDate);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={vendor.name}
        description="Vendor profile"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={vendor.isActive ? "success" : "neutral"}>{vendor.isActive ? "Active" : "Inactive"}</Badge>
            {vendor.recordState === "archived" && <Badge variant="neutral">Archived</Badge>}
            <VendorRecordActions vendor={vendor} />
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-5">
        <Card className="col-span-2">
          <CardContent className="pt-6">
            <VendorForm vendor={vendor} action={updateVendorAction.bind(null, vendor.id)} submitLabel="Save changes" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Purchase Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {pos.length === 0 ? (
              <p className="text-xs text-ink-faint">No purchase orders yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {pos.map((po) => (
                  <div key={po.id} className="flex justify-between text-[13px] border-b border-line pb-2 last:border-0">
                    <span className="font-mono">{po.poNumber}</span>
                    <span className="text-ink-muted">{po.total} SAR</span>
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
