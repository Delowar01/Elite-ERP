import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { ProductForm } from "../product-form";
import { createProductAction } from "../actions";

export default async function NewProductPage() {
  const locale = await getLocale();
  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title={t(locale, "New Product")} description={t(locale, "Add a product to your inventory catalog.")} />
      <Card>
        <CardContent className="pt-6">
          <ProductForm action={createProductAction} submitLabel={t(locale, "Create Product")} />
        </CardContent>
      </Card>
    </div>
  );
}
