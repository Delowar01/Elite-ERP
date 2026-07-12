import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { VendorForm } from "../vendor-form";
import { createVendorAction } from "../actions";

export default function NewVendorPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader title="New Vendor" description="Add a vendor to order and receive against." />
      <Card>
        <CardContent className="pt-6">
          <VendorForm action={createVendorAction} submitLabel="Create Vendor" />
        </CardContent>
      </Card>
    </div>
  );
}
