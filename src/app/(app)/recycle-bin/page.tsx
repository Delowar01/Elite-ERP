import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { DOCUMENT_TYPES, evaluate } from "@/lib/document-lifecycle";
import { DOCUMENT_ADMIN } from "@/lib/document-registry";
import { RecycleBinClient, type BinRow } from "./recycle-bin-client";

export default async function RecycleBinPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const rows: BinRow[] = [];
  for (const docType of DOCUMENT_TYPES) {
    const entry = DOCUMENT_ADMIN[docType];
    const deleted = await entry.listDeleted(session.orgId);
    for (const r of deleted) {
      const isReferenced = (await entry.countReferences(session.orgId, r.id)) > 0;
      // Permanent delete: owner-only, draft-only, unposted, unreferenced, from the Recycle Bin — decided by A1.
      const canPermanentDelete = evaluate(docType, r.status, "permanent_delete", {
        role: session.role,
        recordState: "deleted",
        isReferenced,
      }).allowed;
      rows.push({
        docType,
        id: r.id,
        number: r.number,
        status: r.status,
        partyName: r.partyName,
        typeLabel: entry.typeLabel,
        detailHref: entry.detailHref(r.id),
        deletedAt: r.deletedAt ? r.deletedAt.toISOString().slice(0, 10) : "",
        canPermanentDelete,
      });
    }
  }
  rows.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));

  return <RecycleBinClient locale={locale} rows={rows} isOwner={session.role === "owner"} />;
}
