"use client";

import { useState } from "react";
import { MapPin, Mail, Phone, Globe, Pencil, UserPlus } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { composeAddress } from "@/lib/geo/countries";
import type { CountryProfile } from "@/lib/geo/country-profiles";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Customer } from "@/db";
import { PartyEditDialog } from "./party-edit-dialog";
import { ClientCreateDialog } from "./client-create-dialog";

function PcRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="pc-row">
      {icon}
      <span>{text}</span>
    </div>
  );
}

// Matches the mockup's detail-screen party card exactly: <div class="card party-card">
// <div class="k">Bill from</div><div class="name">...</div><div class="meta">...</div>
// (invoice_main / proforma_main / cn_main etc.) — simpler than the rich create-screen
// party-card-v2 (no icon rows, no edit affordance).
export function PartyCardSimple({
  label,
  name,
  metaLines,
}: {
  label: string;
  name: string;
  metaLines: (string | null | undefined)[];
}) {
  return (
    <div className="card party-card">
      <div className="k">{label}</div>
      <div className="name">{name}</div>
      {metaLines.filter(Boolean).map((line, i) => (
        <div className="meta" key={i}>
          {line}
        </div>
      ))}
    </div>
  );
}

// Matches the mockup's party_card(is_select=False) exactly: <div class="card party-card-v2">
// <div class="pc-label">...</div><div class="pc-name">...</div>{pc-row × N}<div class="pc-edit">...</div>
export function PartyCardStatic({
  locale,
  label,
  name,
  address,
  email,
  phone,
  website,
  editable = true,
}: {
  locale?: Locale;
  label: string;
  name: string;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  /** The "From" card is the org itself → its pencil opens the in-page business-details popup.
   *  Pass false for a derived/read-only party (e.g. a Credit/Debit Note's party copied from its
   *  source document) to hide the pencil. */
  editable?: boolean;
}) {
  const editLabel = locale ? t(locale, "Edit business details") : "Edit business details";
  return (
    <div className="card party-card-v2">
      <div className="pc-label">{label}</div>
      <div className="pc-name">{name}</div>
      {address && <PcRow icon={<MapPin className="size-3.5" />} text={address} />}
      {email && <PcRow icon={<Mail className="size-3.5" />} text={email} />}
      {phone && <PcRow icon={<Phone className="size-3.5" />} text={phone} />}
      {website && <PcRow icon={<Globe className="size-3.5" />} text={website} />}
      {editable && locale && (
        <PartyEditDialog
          locale={locale}
          kind="from"
          initial={{ name, email: email ?? "", phone: phone ?? "", address: address ?? "" }}
          fullSettingsHref="/settings/organization?tab=business-details"
          trigger={
            <button type="button" className="pc-edit" title={editLabel} aria-label={editLabel}>
              <Pencil className="size-3.5" />
            </button>
          }
        />
      )}
    </div>
  );
}

// Matches the mockup's party_card(is_select=True) exactly — same shape as PartyCardStatic
// but the name row is a live <Select> (mockup's ".pc-select" chevron-trigger).
export function PartyCardSelect({
  locale,
  label,
  customers,
  value,
  onChange,
  placeholder = "Select a client",
  partyKind = "client",
  profile,
  taxNumberLabel = "VAT Number",
  registrationLabel = "CR Number",
  defaultCountryCode = "",
}: {
  locale: Locale;
  label: string;
  customers: PartySelectCustomer[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Whether the chosen party is a client or a vendor — drives the in-page edit popup + which
   *  master record it updates. */
  partyKind?: "client" | "vendor";
  /** The org's country profile — drives the edit popup's address layout + tax/registration labels. */
  profile?: CountryProfile;
  taxNumberLabel?: string;
  registrationLabel?: string;
  /** Default country for a client created in-page (the org's country). */
  defaultCountryCode?: string;
}) {
  // Clients created via the in-page "Add New Client" popup are held here and merged into the list so
  // the new record is selectable/selected immediately — no page reload, so unsaved document data and
  // line items are preserved.
  const [created, setCreated] = useState<PartySelectCustomer[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const isClient = partyKind === "client";

  const allCustomers = [...created, ...customers];
  const selected = allCustomers.find((c) => String(c.id) === value);
  const openLabel = t(locale, "Edit");
  const options = allCustomers.map((c) => ({
    value: String(c.id),
    label: c.name,
    // Searchable by name + VAT / CR / phone / email / city / country (not shown in the row).
    keywords: [c.vatNumber, c.taxId, c.phone, c.email, c.city, c.countryCode].filter(Boolean).join(" "),
  }));
  const composed = selected ? composeAddress(selected) || selected.address || "" : "";

  function handleCreated(client: Customer) {
    setCreated((c) => [client as PartySelectCustomer, ...c]);
    onChange(String(client.id)); // auto-select the new client
  }

  return (
    <div className="card party-card-v2">
      <div className="pc-label">{label}</div>
      {/* Searchable client/vendor dropdown; the trigger shows the selected party's name. */}
      <SearchableSelect
        options={options}
        value={value}
        onChange={onChange}
        placeholder={t(locale, placeholder)}
        searchPlaceholder={t(locale, "Search…")}
        emptyText={t(locale, "No matches.")}
        aria-label={label}
        triggerClassName="mt-1 mb-1"
        addNewLabel={isClient ? t(locale, "Add New Client") : undefined}
        onAddNew={isClient ? () => setCreateOpen(true) : undefined}
      />

      {selected ? (
        <>
          {composed && <PcRow icon={<MapPin className="size-3.5" />} text={composed} />}
          {selected.email && <PcRow icon={<Mail className="size-3.5" />} text={selected.email} />}
          {selected.phone && <PcRow icon={<Phone className="size-3.5" />} text={selected.phone} />}
          {selected.vatNumber && (
            <div className="pc-row"><span className="text-ink-faint">{t(locale, taxNumberLabel)}:</span>&nbsp;<span className="font-mono">{selected.vatNumber}</span></div>
          )}
          {selected.taxId && (
            <div className="pc-row"><span className="text-ink-faint">{t(locale, registrationLabel)}:</span>&nbsp;<span className="font-mono">{selected.taxId}</span></div>
          )}
          <PartyEditDialog
            locale={locale}
            kind={partyKind}
            partyId={selected.id}
            profile={profile}
            initial={{
              name: selected.name, email: selected.email ?? "", phone: selected.phone ?? "", address: selected.address ?? "",
              clientType: (selected as { clientType?: string }).clientType ?? "individual",
              countryCode: selected.countryCode ?? "", stateProvince: selected.stateProvince ?? "", district: selected.district ?? "",
              city: selected.city ?? "", buildingNumber: selected.buildingNumber ?? "", additionalNumber: selected.additionalNumber ?? "",
              postalCode: selected.postalCode ?? "", streetAddress: selected.streetAddress ?? "",
            }}
            fullSettingsHref={partyKind === "vendor" ? `/purchasing/vendors/${selected.id}` : `/clients/${selected.id}`}
            trigger={
              <button type="button" className="pc-edit" title={openLabel} aria-label={openLabel}>
                <Pencil className="size-3.5" />
              </button>
            }
          />
        </>
      ) : isClient ? (
        // Empty state: a bordered card prompting selection, with an in-page "Add New Client" action.
        <div className="mt-2 rounded-xl border border-dashed border-line-strong px-4 py-6 text-center">
          <p className="text-[12.5px] text-ink-muted">{t(locale, "Select Client/Business from the list")}</p>
          <p className="text-[11.5px] text-ink-faint my-2">{t(locale, "OR")}</p>
          <button type="button" className="btn btn-primary" style={{ width: "auto", padding: "0 18px" }} onClick={() => setCreateOpen(true)}>
            <UserPlus className="size-4" /> {t(locale, "Add New Client")}
          </button>
        </div>
      ) : null}

      {isClient && (
        <ClientCreateDialog
          locale={locale}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={handleCreated}
          profile={profile}
          taxLabels={{ taxNumberLabel, registrationLabel }}
          defaultCountryCode={defaultCountryCode}
        />
      )}
    </div>
  );
}

// The shape the document client/vendor selector needs. Full Customer/Vendor records satisfy this;
// the structured address + VAT/CR fields are optional so vendors (which lack the structured address)
// still fit.
export type PartySelectCustomer = {
  id: number; name: string;
  address?: string | null; email?: string | null; phone?: string | null;
  vatNumber?: string | null; taxId?: string | null;
  countryCode?: string | null; stateProvince?: string | null; district?: string | null;
  city?: string | null; buildingNumber?: string | null; additionalNumber?: string | null; postalCode?: string | null; streetAddress?: string | null;
};
