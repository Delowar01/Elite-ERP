import { Building2 } from "lucide-react";
import type { Org } from "@/db";

// Matches the mockup's doc_brand_panel() exactly: <div class="card doc-brand-panel">
export function DocBrandPanel({ org }: { org: Pick<Org, "name" | "logoUrl" | "vatNumber" | "currency" | "country"> }) {
  return (
    <div className="card doc-brand-panel">
      {org.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={org.logoUrl} alt={org.name} className="h-13 w-13 rounded-2xl object-cover" style={{ boxShadow: "var(--shadow-sm)" }} />
      ) : (
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: "var(--brand-navy)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <Building2 className="size-7 text-white" />
        </div>
      )}
      <div className="word1">{org.name}</div>
      <div className="word2">
        {org.vatNumber ? `VAT ${org.vatNumber}` : org.currency} · {(org.country ?? "").toUpperCase()}
      </div>
    </div>
  );
}
