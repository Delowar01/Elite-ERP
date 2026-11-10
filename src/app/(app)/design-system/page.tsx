import { notFound } from "next/navigation";
import { Plus, Download, Inbox, MoreHorizontal } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatRow } from "../sales/_shared/stat-row";
import { TOKENS, TOKEN_CSS_NAME, TYPE_SCALE, type CoreTokens } from "@/lib/design-tokens";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";

// Design specimen (LCP design adoption, development only): the tokens, type scale and shared components of the
// Elite ERP design system on one page, rendered by the real components and the live theme (light / dark, the
// organization's colours, English / Arabic). It is not linked from the navigation and answers 404 in production
// unless ELITE_DESIGN_SPECIMEN=1 is set for a review build. Static content only — no data is read or written.
export default async function DesignSpecimenPage() {
  if (process.env.NODE_ENV === "production" && process.env.ELITE_DESIGN_SPECIMEN !== "1") notFound();
  const locale = await getLocale();
  const tokens = Object.keys(TOKEN_CSS_NAME) as (keyof CoreTokens)[];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t(locale, "Design specimen")}
        description={t(locale, "Tokens, type and components of the Elite ERP design system (development only).")}
        actions={
          <Button>
            <Plus aria-hidden /> {t(locale, "Primary action")}
          </Button>
        }
      />

      <section aria-labelledby="sp-colour" className="flex flex-col gap-3">
        <h2 id="sp-colour" className="text-title font-semibold">{t(locale, "Colour tokens")}</h2>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {tokens.map((k) => (
            <div key={k} className="card overflow-hidden">
              <div className="h-12 border-b border-line" style={{ background: `var(${TOKEN_CSS_NAME[k]})` }} />
              <div className="p-3">
                <div className="text-body-sm font-medium font-code" dir="ltr">{TOKEN_CSS_NAME[k]}</div>
                <div className="text-caption text-ink-muted num-tabular" dir="ltr">
                  {TOKENS.light[k]} · {TOKENS.dark[k]}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="sp-type" className="flex flex-col gap-3">
        <h2 id="sp-type" className="text-title font-semibold">{t(locale, "Typography")}</h2>
        <Card>
          <CardContent className="pt-5 flex flex-col gap-2">
            {(Object.keys(TYPE_SCALE) as (keyof typeof TYPE_SCALE)[]).map((step) => (
              <div key={step} className="flex items-baseline gap-4">
                <span className="w-24 shrink-0 text-caption text-ink-muted font-code" dir="ltr">{step}</span>
                <span style={{ fontSize: `var(--text-${step})`, lineHeight: `var(--text-${step}--line-height)` }}>{t(locale, "Invoice INV-0001 — 12,500.00")}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="sp-buttons" className="flex flex-col gap-3">
        <h2 id="sp-buttons" className="text-title font-semibold">{t(locale, "Buttons")}</h2>
        <Card>
          <CardContent className="pt-5 flex flex-wrap items-center gap-3">
            <Button>{t(locale, "Primary action")}</Button>
            <Button variant="secondary">{t(locale, "Secondary")}</Button>
            <Button variant="outline">
              <Download aria-hidden /> {t(locale, "Export")}
            </Button>
            <Button variant="ghost" size="icon" aria-label={t(locale, "Actions")} title={t(locale, "Actions")}>
              <MoreHorizontal aria-hidden />
            </Button>
            <Button variant="destructive">{t(locale, "Delete")}</Button>
            <Button variant="link">{t(locale, "View details")}</Button>
            <Button size="sm">{t(locale, "Small")}</Button>
            <Button size="lg">{t(locale, "Large")}</Button>
            <Button disabled>{t(locale, "Disabled")}</Button>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="sp-forms" className="flex flex-col gap-3">
        <h2 id="sp-forms" className="text-title font-semibold">{t(locale, "Form controls")}</h2>
        <Card>
          <CardContent className="pt-5 grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-body-sm font-medium text-ink-muted">{t(locale, "Client name")}</span>
              <Input placeholder={t(locale, "Type to search…")} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-body-sm font-medium text-ink-muted">{t(locale, "Read-only")}</span>
              <Input readOnly defaultValue="INV-0001" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-body-sm font-medium text-ink-muted">{t(locale, "Invalid")}</span>
              <Input aria-invalid defaultValue="—" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-body-sm font-medium text-ink-muted">{t(locale, "Notes")}</span>
              <Textarea rows={2} />
            </label>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="sp-status" className="flex flex-col gap-3">
        <h2 id="sp-status" className="text-title font-semibold">{t(locale, "Status")}</h2>
        <Card>
          <CardContent className="pt-5 flex flex-wrap items-center gap-2">
            {(["draft", "sent", "partially_paid", "paid", "void"] as const).map((s) => (
              <StatusBadge key={s} domain="sales_invoice" status={s} locale={locale} />
            ))}
            <StatusBadge domain="leave" status="pending" locale={locale} />
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="sp-cards" className="flex flex-col gap-3">
        <h2 id="sp-cards" className="text-title font-semibold">{t(locale, "Cards and KPIs")}</h2>
        <StatRow
          items={[
            { label: t(locale, "Total Invoices"), value: "8" },
            { label: t(locale, "Paid"), value: "2" },
            { label: t(locale, "Amount"), value: "13,271.00" },
            { label: t(locale, "Draft"), value: "1" },
          ]}
        />
        <Card>
          <CardHeader>
            <CardTitle as="h3">{t(locale, "Card title")}</CardTitle>
            <CardDescription>{t(locale, "Supporting text in the muted ink.")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="a">
              <TabsList>
                <TabsTrigger value="a">{t(locale, "Overview")}</TabsTrigger>
                <TabsTrigger value="b">{t(locale, "Activity")}</TabsTrigger>
              </TabsList>
              <TabsContent value="a" className="text-body text-ink-muted">{t(locale, "Overview")}</TabsContent>
              <TabsContent value="b" className="text-body text-ink-muted">{t(locale, "Activity")}</TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="sp-table" className="flex flex-col gap-3">
        <h2 id="sp-table" className="text-title font-semibold">{t(locale, "Table")}</h2>
        <Table list>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Invoice #")}</TableHead>
              <TableHead>{t(locale, "Client")}</TableHead>
              <TableHead numeric>{t(locale, "Amount")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {([["INV-0002", "Blue Harbor Events (Fictional)", "28,842.00", "partially_paid"], ["INV-0001", "Al Noor Contracting (Fictional)", "43,240.00", "paid"]] as const).map(([n, c, a, s]) => (
              <TableRow key={n}>
                <TableCell className="font-code">{n}</TableCell>
                <TableCell>{c}</TableCell>
                <TableCell numeric>{a}</TableCell>
                <TableCell>
                  <StatusBadge domain="sales_invoice" status={s} locale={locale} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section aria-labelledby="sp-empty" className="flex flex-col gap-3">
        <h2 id="sp-empty" className="text-title font-semibold">{t(locale, "Empty state")}</h2>
        <EmptyState
          message={t(locale, "Nothing here yet.")}
          hint={t(locale, "Records you create will appear in this list.")}
          action={
            <Button variant="secondary">
              <Inbox aria-hidden /> {t(locale, "Create a record")}
            </Button>
          }
        />
      </section>
    </div>
  );
}
