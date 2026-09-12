-- =============================================================================
-- Elite ERP — PRODUCTION VERIFICATION PACK (read-only)
-- Prepared by the audit of 2026-09-12 at commit 04457ff. Run by the owner.
--
-- EVERY statement here is a SELECT. Nothing writes, locks, or alters anything.
-- Run it against production with a read-capable role. It needs no password to be
-- shared with anyone and reveals no customer data — only schema shape and counts.
--
-- WHY THIS EXISTS: nothing in the repository records what is deployed. The audit
-- could not establish it and did not try (no credentials were sought). These
-- queries close that gap.
--
-- IMPORTANT: column presence alone does NOT establish deployment completeness.
-- Q1 tells you the columns exist; Q2-Q6 tell you whether the code that uses them
-- is live, whether the controls that must accompany them are installed, and
-- whether any backfill still has work to do. Read all six.
-- =============================================================================

\echo '=== Q1. Do the six pending columns exist? (expect 6 rows) ==='
select table_name, column_name, data_type, is_nullable, coalesce(column_default,'-') as default
  from information_schema.columns
 where table_schema = 'public'
   and (   (table_name = 'payments'       and column_name in ('reversed_at','reversed_by_id'))
        or (table_name = 'sales_invoices' and column_name in ('credited_amount','base_credited_amount'))
        or (table_name = 'bank_accounts'  and column_name in ('opening_date','opening_contra_account_id')))
 order by table_name, column_name;
-- Expected, exactly:
--   bank_accounts.opening_contra_account_id  integer                       YES  -
--   bank_accounts.opening_date               date                          YES  -
--   payments.reversed_at                     timestamp without time zone   YES  -
--   payments.reversed_by_id                  integer                       YES  -
--   sales_invoices.base_credited_amount      numeric                       YES  -
--   sales_invoices.credited_amount           numeric                       NO   '0'::numeric
-- FEWER THAN 6 ROWS => the schema step has not been run. Do not deploy the code.

\echo ''
\echo '=== Q2. Overall schema shape — is this a push-built or a migrations-built database? ==='
select (select count(*) from information_schema.tables
          where table_schema='public' and table_type='BASE TABLE')          as tables,
       (select count(*) from information_schema.columns
          where table_schema='public')                                      as columns;
-- A database built by `npm run db:push` at 04457ff has 66 tables / 812 columns.
-- A database built by the COMMITTED MIGRATIONS ONLY has 59 tables / 609 columns.
-- The gap measured in the audit: 7 whole tables, 204 columns to add and 1 to
-- drop (608 shared) -- a NET +203, which is why 812 - 609 is 203 and not 204.
-- Anything near the lower figure means `db:migrate` was used and the deployment
-- is incomplete.

\echo ''
\echo '=== Q3. Are the seven tables a migrations-only deploy would be missing present? ==='
select t.name,
       (select count(*) from information_schema.tables
         where table_schema='public' and table_name = t.name) as present
  from (values ('advance_applications'),('advance_application_releases'),
               ('document_attachments'),('document_column_configs'),
               ('exchange_rates'),('rate_fetch_attempts'),('seal_signature_assets')) as t(name)
 order by 1;
-- Every row must read present = 1.

\echo ''
\echo '=== Q4. Are the append-only audit triggers installed? (expect 2) ==='
select tgname, relname as on_table
  from pg_trigger join pg_class on pg_class.oid = pg_trigger.tgrelid
 where tgname in ('audit_logs_immutable','security_events_immutable')
 order by 1;
-- These are installed by `npm run db:harden`, which `npm run db:push` chains.
-- Running `drizzle-kit push` DIRECTLY does not install them — verified in the
-- audit: a raw push produced 0 of 2. If this returns fewer than 2 rows the audit
-- trail is mutable, regardless of what the Compliance page reports.

\echo ''
\echo '=== Q5. Outstanding backfills — is there work the deployed code will not do for itself? ==='
-- (a) bank opening balances recorded the legacy way, with no opening journal entry
select count(*) as bank_accounts_needing_opening_backfill
  from bank_accounts b
 where coalesce(b.opening_balance, 0) <> 0
   and not exists (select 1 from journal_entries je
                    where je.source_type = 'bank_opening' and je.source_id = b.id);
-- Non-zero => the bank-opening backfill has not been run. It runs AFTER the code
-- deploy, unlike every other step — see the runbook in docs/backlog.md.

-- (b) invoices whose credited_amount is still the pre-split default while credit
--     notes exist against them
select count(*) as invoices_with_notes_but_zero_credited
  from sales_invoices si
 where coalesce(si.credited_amount, 0) = 0
   and exists (select 1 from credit_notes cn
                where cn.source_invoice_id = si.id and cn.status <> 'draft');
-- The audit's runbook check concluded NO backfill is required here, because the
-- old and new outstanding formulas agree when credited_amount = 0. A non-zero
-- count is therefore EXPECTED and is not a defect — it is the legacy display
-- residue only. Recorded so the number is not mistaken for a problem.

-- (c) foreign documents with no stored base conversion (reporting completeness)
select count(*) as invoices_without_stored_base
  from sales_invoices
 where currency is not null and base_total is null and status <> 'draft';
-- These are excluded from base-currency reporting AND counted by the product.
-- This number tells you how much history that exclusion covers.

\echo ''
\echo '=== Q6. Is the reversal feature actually being used? (proves the CODE is live, not just the columns) ==='
select (select count(*) from payments where reversed_at is not null) as payments_reversed,
       (select count(*) from journal_entries where source_type = 'payment_reversal') as reversal_entries,
       (select max(created_at)::date from journal_entries where source_type = 'payment_reversal') as last_reversal;
-- Columns can exist while the code that writes them is not deployed. A non-zero
-- reversal_entries count is positive evidence the payment-reversal code is live.
-- ZERO is NOT proof it is absent -- it may simply be unused. Treat zero as
-- inconclusive and confirm the deployed commit separately: see section 1,
-- "Which commit is live", in production-verification-README.md (same folder).
