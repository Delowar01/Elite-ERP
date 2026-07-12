import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ProductForm } from "../product-form";
import { createProductAction } from "../actions";

export default function NewProductPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader title="New Product" description="Add a product to your inventory catalog." />
      <Card>
        <CardContent className="pt-6">
          <ProductForm action={createProductAction} submitLabel="Create Product" />
        </CardContent>
      </Card>
    </div>
  );
}
