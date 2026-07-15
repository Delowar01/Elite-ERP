import { asc, eq } from "drizzle-orm";
import {
  db,
  taxPresetsTable,
  paymentTermPresetsTable,
  unitsTable,
  departmentsTable,
  productCategoriesTable,
  leaveTypesTable,
  expenseCategoriesTable,
  noteTemplatesTable,
  productBundlesTable,
  productBundleItemsTable,
  productsTable,
  documentSequencesTable,
  DOCUMENT_TYPES,
} from "@/db";
import { requireRole } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { tenantScope } from "@/lib/tenant";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SimplePresetPanel } from "./simple-preset-panel";
import { NoteTemplatesPanel } from "./note-templates-panel";
import { BundlesPanel } from "./bundles-panel";
import { NumberingPanel } from "./numbering-panel";
import {
  createTaxPresetAction,
  updateTaxPresetAction,
  deleteTaxPresetAction,
  createPaymentTermAction,
  updatePaymentTermAction,
  deletePaymentTermAction,
  createUnitAction,
  updateUnitAction,
  deleteUnitAction,
  createDepartmentAction,
  updateDepartmentAction,
  deleteDepartmentAction,
  createProductCategoryAction,
  updateProductCategoryAction,
  deleteProductCategoryAction,
  createLeaveTypeAction,
  updateLeaveTypeAction,
  deleteLeaveTypeAction,
  createExpenseCategoryAction,
  updateExpenseCategoryAction,
  deleteExpenseCategoryAction,
} from "./actions";

export default async function PresetsPage() {
  const session = await requireRole("owner", "admin");
  const locale = await getLocale();
  const orgId = session.orgId;

  const [
    taxPresets,
    paymentTerms,
    units,
    departments,
    productCategories,
    leaveTypes,
    expenseCategories,
    noteTemplates,
    bundles,
    bundleItems,
    products,
    sequencesUnordered,
  ] = await Promise.all([
    db.select().from(taxPresetsTable).where(eq(taxPresetsTable.orgId, orgId)).orderBy(asc(taxPresetsTable.name)),
    db.select().from(paymentTermPresetsTable).where(eq(paymentTermPresetsTable.orgId, orgId)).orderBy(asc(paymentTermPresetsTable.netDays)),
    db.select().from(unitsTable).where(eq(unitsTable.orgId, orgId)).orderBy(asc(unitsTable.name)),
    db.select().from(departmentsTable).where(eq(departmentsTable.orgId, orgId)).orderBy(asc(departmentsTable.name)),
    db.select().from(productCategoriesTable).where(eq(productCategoriesTable.orgId, orgId)).orderBy(asc(productCategoriesTable.name)),
    db.select().from(leaveTypesTable).where(eq(leaveTypesTable.orgId, orgId)).orderBy(asc(leaveTypesTable.name)),
    db.select().from(expenseCategoriesTable).where(eq(expenseCategoriesTable.orgId, orgId)).orderBy(asc(expenseCategoriesTable.name)),
    db.select().from(noteTemplatesTable).where(eq(noteTemplatesTable.orgId, orgId)).orderBy(asc(noteTemplatesTable.name)),
    db.select().from(productBundlesTable).where(eq(productBundlesTable.orgId, orgId)).orderBy(asc(productBundlesTable.name)),
    db
      .select({
        id: productBundleItemsTable.id,
        bundleId: productBundleItemsTable.bundleId,
        productId: productBundleItemsTable.productId,
        quantity: productBundleItemsTable.quantity,
        productName: productsTable.name,
        productSku: productsTable.sku,
      })
      .from(productBundleItemsTable)
      .innerJoin(productsTable, eq(productsTable.id, productBundleItemsTable.productId)),
    db
      .select({ id: productsTable.id, name: productsTable.name, sku: productsTable.sku })
      .from(productsTable)
      .where(tenantScope(orgId, productsTable))
      .orderBy(asc(productsTable.name)),
    db.select().from(documentSequencesTable).where(eq(documentSequencesTable.orgId, orgId)),
  ]);

  const bundlesWithItems = bundles.map((bundle) => ({
    ...bundle,
    items: bundleItems.filter((item) => item.bundleId === bundle.id),
  }));

  const sequenceOrder = new Map(DOCUMENT_TYPES.map((dt, i) => [dt, i]));
  const sequences = [...sequencesUnordered].sort(
    (a, b) => (sequenceOrder.get(a.documentType as (typeof DOCUMENT_TYPES)[number]) ?? 99) - (sequenceOrder.get(b.documentType as (typeof DOCUMENT_TYPES)[number]) ?? 99),
  );

  return (
    <div className="max-w-5xl">
      <div className="main-head">
        <h3>{t(locale, "Presets")}</h3>
      </div>

      <Tabs defaultValue="tax-rates">
        <TabsList>
          <TabsTrigger value="tax-rates">{t(locale, "Tax Rates")}</TabsTrigger>
          <TabsTrigger value="payment-terms">{t(locale, "Payment Terms")}</TabsTrigger>
          <TabsTrigger value="units">{t(locale, "Units")}</TabsTrigger>
          <TabsTrigger value="note-templates">{t(locale, "Note Templates")}</TabsTrigger>
          <TabsTrigger value="bundles">{t(locale, "Bundles")}</TabsTrigger>
          <TabsTrigger value="numbering">{t(locale, "Numbering")}</TabsTrigger>
          <TabsTrigger value="departments">{t(locale, "Departments")}</TabsTrigger>
          <TabsTrigger value="product-categories">{t(locale, "Product Categories")}</TabsTrigger>
          <TabsTrigger value="leave-types">{t(locale, "Leave Types")}</TabsTrigger>
          <TabsTrigger value="expense-categories">{t(locale, "Expense Categories")}</TabsTrigger>
        </TabsList>

        <TabsContent value="tax-rates">
          <SimplePresetPanel
            locale={locale}
            items={taxPresets.map((p) => ({ id: p.id, name: p.name, extra: p.ratePercent }))}
            extraLabel={t(locale, "Rate %")}
            extraType="number"
            addLabel={t(locale, "Add Tax Preset")}
            emptyLabel={t(locale, "No tax presets yet.")}
            create={createTaxPresetAction}
            update={updateTaxPresetAction}
            remove={deleteTaxPresetAction}
          />
        </TabsContent>

        <TabsContent value="payment-terms">
          <SimplePresetPanel
            locale={locale}
            items={paymentTerms.map((p) => ({ id: p.id, name: p.name, extra: p.netDays }))}
            extraLabel={t(locale, "Net Days")}
            extraType="number"
            addLabel={t(locale, "Add Payment Term")}
            emptyLabel={t(locale, "No payment terms yet.")}
            create={createPaymentTermAction}
            update={updatePaymentTermAction}
            remove={deletePaymentTermAction}
          />
        </TabsContent>

        <TabsContent value="units">
          <SimplePresetPanel
            locale={locale}
            items={units.map((u) => ({ id: u.id, name: u.name, extra: u.abbreviation }))}
            extraLabel={t(locale, "Abbreviation")}
            addLabel={t(locale, "Add Unit")}
            emptyLabel={t(locale, "No units yet.")}
            create={createUnitAction}
            update={updateUnitAction}
            remove={deleteUnitAction}
          />
        </TabsContent>

        <TabsContent value="note-templates">
          <NoteTemplatesPanel locale={locale} templates={noteTemplates} />
        </TabsContent>

        <TabsContent value="bundles">
          <BundlesPanel locale={locale} bundles={bundlesWithItems} products={products} />
        </TabsContent>

        <TabsContent value="numbering">
          <NumberingPanel locale={locale} sequences={sequences} />
        </TabsContent>

        <TabsContent value="departments">
          <SimplePresetPanel
            locale={locale}
            items={departments.map((d) => ({ id: d.id, name: d.name, extra: null }))}
            extraLabel={null}
            addLabel={t(locale, "Add Department")}
            emptyLabel={t(locale, "No departments yet.")}
            create={createDepartmentAction}
            update={updateDepartmentAction}
            remove={deleteDepartmentAction}
          />
        </TabsContent>

        <TabsContent value="product-categories">
          <SimplePresetPanel
            locale={locale}
            items={productCategories.map((c) => ({ id: c.id, name: c.name, extra: null }))}
            extraLabel={null}
            addLabel={t(locale, "Add Product Category")}
            emptyLabel={t(locale, "No product categories yet.")}
            create={createProductCategoryAction}
            update={updateProductCategoryAction}
            remove={deleteProductCategoryAction}
          />
        </TabsContent>

        <TabsContent value="leave-types">
          <SimplePresetPanel
            locale={locale}
            items={leaveTypes.map((l) => ({ id: l.id, name: l.name, extra: l.daysPerYear }))}
            extraLabel={t(locale, "Days / Year")}
            extraType="number"
            addLabel={t(locale, "Add Leave Type")}
            emptyLabel={t(locale, "No leave types yet.")}
            create={createLeaveTypeAction}
            update={updateLeaveTypeAction}
            remove={deleteLeaveTypeAction}
          />
        </TabsContent>

        <TabsContent value="expense-categories">
          <SimplePresetPanel
            locale={locale}
            items={expenseCategories.map((c) => ({ id: c.id, name: c.name, extra: null }))}
            extraLabel={null}
            addLabel={t(locale, "Add Expense Category")}
            emptyLabel={t(locale, "No expense categories yet.")}
            create={createExpenseCategoryAction}
            update={updateExpenseCategoryAction}
            remove={deleteExpenseCategoryAction}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
