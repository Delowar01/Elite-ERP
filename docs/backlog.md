# Backlog — deferred decisions

Things deliberately not done, with the reasoning that led there. The point of this file is that
nobody has to re-derive the analysis when the item comes up again. An entry here is a decision that
was made and postponed, not an idea someone had.

---

## Remaining untranslated modules

**Status:** deferred, not started. Distinct from the chart-of-accounts naming work, which is scoped
to account names only.

The project convention is that every UI string ships with native Arabic from the outset. Three
areas predate or escaped that and are substantially English regardless of the selected locale:

| Module | Notes |
|---|---|
| Security Center | Flagged in the features audit as substantially English. |
| Compliance Center | Same. |
| Vendors | Every field label in `purchasing/vendors/vendor-form.tsx` is a raw string — "Name", "Email", "Address", "Notes" — and the list/page chrome around it follows. |

**Vendors has a wrinkle worth knowing before picking this up.** The in-document "Add New Vendor"
popup reuses the full-page `VendorForm`, so the popup's own chrome (title, buttons, discard
confirmation) is translated while the fields inside it are not. Translating the popup alone would
make that split worse, not better — the fix has to touch the full-page form, which is why it was
not folded into the in-document creation task. Doing it means adding a `locale` prop to
`VendorForm` and updating both call sites.

---

## Structured addresses for vendors

**Status:** deferred, not started. Not a blocker for anything currently shipped.

`customers` carries structured address fields — `countryCode`, `stateProvince`, `district`, `city`,
`buildingNumber`, `additionalNumber` (Saudi National Address secondary identifier), `postalCode`,
`streetAddress` — alongside a retained single-line `address`. `vendors` has only the single-line
`address`. So a vendor's address renders as one line on purchase orders, debit notes and their PDFs,
where a client's renders structured.

**Why it was not done as part of in-document vendor creation.** It is not required for it. The
in-document creation pattern is a dialog wrapping the module's own existing form plus an inline
action that returns the record; none of it touches the address shape. The shared party selector was
already built to accommodate the difference — `PartySelectCustomer` in
`src/app/(app)/sales/_shared/party-card.tsx` marks the structured fields optional with the comment
*"so vendors (which lack the structured address) still fit"* — and `PartyEditDialog` already runs
with `kind="vendor"`, passing the structured fields as empty strings.

**The shape it should take when it is done.** Follow what `customers` already did rather than
inventing something new: add the structured columns as nullable, and **keep** the existing
`address` column for rows that predate them. Do not attempt to parse existing values into
components — "Building 4, King Fahd Rd, Riyadh 12345" cannot be reliably decomposed, and a lossy
parse silently corrupts vendor records that nobody will re-check. `customers.address` carries the
comment *"Legacy single-line address kept for existing clients; the structured fields below are
preferred"*, which is the precedent. That makes this a dual-write period, not a migration, and the
read path has to handle both for as long as unmigrated rows exist.

**Scope when picked up:** schema columns, vendor form rework, the party card's vendor branch, the
PO/DN PDF address block, and a decision about whether existing vendors are ever backfilled by hand.

---

## Per-module and custom role permissions

**Status:** deferred, not started. This is a known gap, currently documented in the product rather
than fixed.

Access is decided by three idioms and there is no permissions engine: `requireRole(...)`, an inline
`if (session.role === "staff")`, and the document lifecycle rule matrix. Roles are fixed —
owner, admin, staff — and cannot be edited or extended.

**The consequence, stated plainly because it is a sales objection and not an accident.** Sales and
Finance have no role checks at all below the module level. Staff can void invoices, issue credit and
debit notes, receive purchase orders, record payments, and post manual journal entries — all of
which post to the ledger. The Roles & Permissions panel now says so directly rather than implying a
restriction that does not exist (`src/lib/role-matrix.ts`, rendered by
`settings/organization/reference-panels.tsx`).

**Why it was not narrowed as part of correcting that panel.** Deciding which of those capabilities a
staff member should lose is a product design question with real consequences for existing customers'
workflows, and it needs a permissions model to express the answer. Tightening a few individual
actions inside a copy fix would have produced an arbitrary line nobody had agreed to.

**What protects the current state meanwhile:** `scratchpad/verify-role-matrix.mts` asserts the
declared matrix against the guards in the code in both directions, so a gate added or removed
without updating the matrix fails the check.
