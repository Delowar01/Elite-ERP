/**
 * DEV-UI-01.4 — control gallery for `run.mjs capture-controls`.
 *
 * Renders the REAL production control primitives (src/components/ui/*) with esbuild, client-side, so
 * Radix behaviour (open menus, keyboard) is the real thing. It is NOT an application route: run.mjs
 * serves this bundle through Playwright request interception on the baseline server's origin, inside
 * a page that links the app's own compiled stylesheets and font classes. Nothing here ships.
 *
 * window.__GALLERY__ = { group, locale } picks one section.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Plus, Trash2, Pencil, MoreVertical, Eye, Copy, FileText, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@/components/ui/dropdown-menu";
import { RowMenu } from "@/app/(app)/sales/_shared/row-menu";

type Cfg = { group: string; locale: "en" | "ar" };
const cfg: Cfg = (window as unknown as { __GALLERY__: Cfg }).__GALLERY__;
const ar = cfg.locale === "ar";
const L = (en: string, a: string) => (ar ? a : en);

const OPTIONS = [
  { value: "full_time", label: L("Full time", "دوام كامل") },
  { value: "part_time", label: L("Part time", "دوام جزئي") },
  { value: "contract", label: L("Contract (fixed-term, renewable annually)", "عقد (محدد المدة، قابل للتجديد سنويًا)") },
];
const CLIENTS = [
  { value: "1", label: L("Al Noor Contracting (Fictional)", "مؤسسة النور للمقاولات (وهمية)"), sublabel: "Riyadh" },
  { value: "2", label: L("Blue Harbor Events (Fictional)", "فعاليات الميناء الأزرق (وهمية)"), sublabel: "Jeddah" },
  { value: "3", label: L("Cedar Line Hospitality (Fictional)", "ضيافة خط الأرز (وهمية)"), sublabel: "Khobar" },
  { value: "4", label: L("Desert Rose Exhibitions (Fictional)", "معارض وردة الصحراء (وهمية)"), sublabel: "Dammam" },
];

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2" data-gallery-row={title}>
      <div className="text-caption text-ink-faint">{title}</div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

function Buttons() {
  const variants = ["primary", "secondary", "glass", "outline", "ghost", "destructive", "destructive-ghost", "link"] as const;
  return (
    <>
      {variants.map((v) => (
        <Row key={v} title={`variant=${v}`}>
          <Button variant={v} size="sm">{L("Small", "صغير")}</Button>
          <Button variant={v}>{L("Default", "افتراضي")}</Button>
          <Button variant={v} size="lg">{L("Large", "كبير")}</Button>
          <Button variant={v} size="icon" aria-label={L("Edit", "تعديل")}><Pencil /></Button>
          <Button variant={v} size="icon-sm" aria-label={L("Delete", "حذف")}><Trash2 /></Button>
          <Button variant={v} disabled>{L("Disabled", "معطّل")}</Button>
          <Button variant={v} loading>{L("Saving", "جارٍ الحفظ")}</Button>
          <Button variant={v} size="icon" loading aria-label={L("Saving", "جارٍ الحفظ")}><Plus /></Button>
        </Row>
      ))}
      <Row title="legacy .btn">
        <button type="button" className="btn btn-glass" style={{ padding: "0 14px" }}>{L("Legacy glass", "زر قديم")}</button>
        <button type="button" className="btn btn-primary" style={{ width: "auto", padding: "0 14px" }}>{L("Legacy primary", "أساسي قديم")}</button>
        <button type="button" className="btn btn-glass" style={{ padding: "0 14px" }} disabled>{L("Disabled", "معطّل")}</button>
        <button type="button" className="doc-pill-btn">{L("Pill", "خيار")}</button>
      </Row>
    </>
  );
}

function Fields() {
  return (
    <div className="grid max-w-[720px] grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5"><Label htmlFor="g-in1">{L("Default", "افتراضي")}</Label><Input id="g-in1" defaultValue={L("Kestrel Supply LLC", "شركة كيستريل للتوريد")} /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="g-in2">{L("Placeholder", "نص إرشادي")}</Label><Input id="g-in2" placeholder={L("Search clients…", "ابحث عن العملاء…")} /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="g-in3">{L("Disabled", "معطّل")}</Label><Input id="g-in3" disabled defaultValue="INV-0006" /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="g-in4">{L("Read-only", "للقراءة فقط")}</Label><Input id="g-in4" readOnly defaultValue="SAR" /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="g-in5">{L("Invalid", "غير صالح")}</Label><Input id="g-in5" aria-invalid defaultValue="12AB" /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="g-in6">{L("Number", "رقم")}</Label><Input id="g-in6" type="number" defaultValue="1250.50" /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="g-ta1">{L("Textarea", "نص متعدد الأسطر")}</Label><Textarea id="g-ta1" defaultValue={L("Delivery within 14 days.", "التسليم خلال 14 يومًا.")} /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="g-ta2">{L("Textarea disabled", "نص معطّل")}</Label><Textarea id="g-ta2" disabled defaultValue="—" /></div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="g-ta3">{L("Textarea invalid", "نص غير صالح")}</Label><Textarea id="g-ta3" aria-invalid defaultValue="?" /></div>
    </div>
  );
}

function Selects() {
  const [v, setV] = useState("full_time");
  return (
    <div className="grid max-w-[720px] grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="g-se1">{L("Select (selected)", "قائمة (محدد)")}</Label>
        <Select value={v} onValueChange={setV}>
          <SelectTrigger id="g-se1" data-gallery="select-main"><SelectValue /></SelectTrigger>
          <SelectContent>{OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="g-in-al">{L("Input (alignment)", "حقل (محاذاة)")}</Label>
        <Input id="g-in-al" defaultValue={L("Same 36px row", "نفس الارتفاع")} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="g-se2">{L("Select (placeholder)", "قائمة (إرشادي)")}</Label>
        <Select value="" onValueChange={() => {}}>
          <SelectTrigger id="g-se2"><SelectValue placeholder={L("Select a department", "اختر القسم")} /></SelectTrigger>
          <SelectContent>{OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="g-se3">{L("Select (disabled)", "قائمة (معطّلة)")}</Label>
        <Select value="contract" disabled>
          <SelectTrigger id="g-se3"><SelectValue /></SelectTrigger>
          <SelectContent>{OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="g-se4">{L("Select (invalid)", "قائمة (غير صالحة)")}</Label>
        <Select value="" onValueChange={() => {}}>
          <SelectTrigger id="g-se4" aria-invalid><SelectValue placeholder={L("Required", "مطلوب")} /></SelectTrigger>
          <SelectContent>{OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  );
}

function Searchables() {
  const [v, setV] = useState("2");
  return (
    <div className="grid max-w-[720px] grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="g-ss1">{L("Searchable (selected)", "قائمة بحث (محدد)")}</Label>
        <SearchableSelect id="g-ss1" options={CLIENTS} value={v} onChange={setV} placeholder={L("Select a client", "اختر عميلًا")} searchPlaceholder={L("Search…", "بحث…")} emptyText={L("No matches.", "لا نتائج.")} addNewLabel={L("Add New Client", "إضافة عميل جديد")} onAddNew={() => {}} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="g-ss2">{L("Searchable (disabled)", "قائمة بحث (معطّلة)")}</Label>
        <SearchableSelect id="g-ss2" options={CLIENTS} value="1" onChange={() => {}} disabled />
      </div>
    </div>
  );
}

function Checks() {
  const [a, setA] = useState(true);
  const [r, setR] = useState("company");
  return (
    <div className="flex flex-col gap-4">
      <Row title="checkbox">
        <label className="inline-flex items-center gap-2 text-body"><Checkbox data-gallery="cb-1" /> {L("Unchecked", "غير محدد")}</label>
        <label className="inline-flex items-center gap-2 text-body"><Checkbox checked={a} onCheckedChange={(x) => setA(x === true)} /> {L("Checked", "محدد")}</label>
        <label className="inline-flex items-center gap-2 text-body"><Checkbox disabled /> {L("Disabled", "معطّل")}</label>
        <label className="inline-flex items-center gap-2 text-body"><Checkbox disabled checked /> {L("Disabled checked", "معطّل محدد")}</label>
        <label className="inline-flex items-center gap-2 text-body"><Checkbox aria-invalid /> {L("Invalid", "غير صالح")}</label>
      </Row>
      <Row title="radio">
        <RadioGroup name="g-radio" value={r} onValueChange={setR} aria-label={L("Client Type", "نوع العميل")}>
          <RadioGroupItem value="individual">{L("Individual", "فرد")}</RadioGroupItem>
          <RadioGroupItem value="company">{L("Company", "شركة")}</RadioGroupItem>
          <RadioGroupItem value="government" disabled>{L("Government", "جهة حكومية")}</RadioGroupItem>
        </RadioGroup>
      </Row>
    </div>
  );
}

function TabsAndMenu() {
  return (
    <div className="flex flex-col gap-6">
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">{L("Business Details", "بيانات الشركة")}</TabsTrigger>
          <TabsTrigger value="logo">{L("Logo", "الشعار")}</TabsTrigger>
          <TabsTrigger value="theme">{L("Color Theme", "نمط الألوان")}</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="text-body text-ink-muted">{L("Tab content", "محتوى التبويب")}</TabsContent>
      </Tabs>
      <Row title="row menu">
        {/* The same trigger markup RowMenu renders (sales/_shared/row-menu.tsx). */}
        <DropdownMenu>
          <DropdownMenuTrigger className="row-menu-btn outline-none" aria-label={L("Row actions", "إجراءات الصف")}>
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>{L("View", "عرض")}</DropdownMenuItem>
            <DropdownMenuItem className="danger">{L("Delete", "حذف")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Row>
    </div>
  );
}

// DEV-UI-01.4-C1: open menus in both directions. The REAL shared RowMenu (sales/_shared/row-menu.tsx,
// entries without href) at the inline end of a table-like row, and a DropdownMenu with a Radix Sub.
function Menus() {
  const noop = () => {};
  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <div className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3" data-gallery-row="row menu">
        <span className="text-body text-ink">{L("INV-0006 · Al Noor Contracting (Fictional)", "INV-0006 · مؤسسة النور للمقاولات (وهمية)")}</span>
        <RowMenu
          entries={[
            { kind: "item", icon: Eye, label: L("View", "عرض"), onSelect: noop },
            { kind: "item", icon: Copy, label: L("Duplicate", "تكرار"), onSelect: noop },
            { kind: "convert", label: L("Convert to", "تحويل إلى"), targets: [{ label: L("Invoice", "فاتورة"), icon: FileText, onSelect: noop }, { label: L("Delivery Challan", "إذن تسليم"), icon: Truck, onSelect: noop }] },
            { kind: "separator" },
            { kind: "item", icon: Trash2, label: L("Delete", "حذف"), onSelect: noop, danger: true },
          ]}
        />
      </div>
      <div className="flex items-center justify-between" data-gallery-row="submenu">
        <span className="text-body text-ink-muted">{L("Radix submenu", "قائمة فرعية")}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" data-gallery="sub-trigger">{L("More", "المزيد")}</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>{L("Duplicate", "تكرار")}</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-gallery="sub">{L("Export", "تصدير")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>PDF</DropdownMenuItem>
                <DropdownMenuItem>Excel</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

const GROUPS: Record<string, () => React.ReactElement> = { buttons: Buttons, fields: Fields, selects: Selects, searchables: Searchables, checks: Checks, tabs: TabsAndMenu, menus: Menus };

function Gallery() {
  const G = GROUPS[cfg.group];
  return (
    <main className="min-h-screen bg-canvas p-6 text-ink" data-gallery-group={cfg.group}>
      <div className="mb-4 text-title-sm font-semibold">{`DEV-UI-01.4 controls · ${cfg.group}`}</div>
      <div className="flex flex-col gap-5">{G ? <G /> : null}</div>
    </main>
  );
}

createRoot(document.getElementById("gallery-root")!).render(<Gallery />);
