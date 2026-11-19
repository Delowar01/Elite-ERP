-- =============================================================================================
-- PO-02D3 — READ-ONLY e-mail uniqueness audit of the customer `users` table (decision A-7 / I-7, D-7).
-- Run it (under an owner-approved D-7 measurement) BEFORE approving the lower(email) unique index
-- (docs/platform-owner/po02d3/proposal/users_email_lower_unique.proposal.sql). It changes nothing:
-- one READ ONLY transaction, rolled back. It prints counts and user ids only — never an e-mail address.
--     psql -v ON_ERROR_STOP=1 -f users_email_audit_readonly.sql
--
--   E1  case-insensitive duplicate groups — MUST be 0 before the index can be built (the build fails otherwise)
--   E2  rows not stored normalized (email <> lower(btrim(email))) — such an account can never sign in,
--       because sign-in looks the address up lower-cased; each needs an owner decision
--   E3  rows with surrounding white space (a subset of E2)
--   E4  rows containing non-ASCII characters — reviewed so lower() and JavaScript folding agree
--   E5  pending invitations whose owner e-mail is already a customer user (any letter case) — must be 0
--   E6  table size, to size the CONCURRENTLY build
-- =============================================================================================

\set ON_ERROR_STOP on
-- statement
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

-- statement
SELECT 'E1' AS check_id, count(*)::bigint AS groups, coalesce(max(n), 0)::bigint AS largest_group,
       coalesce(sum(n), 0)::bigint AS rows_involved
FROM (SELECT count(*) AS n FROM public.users GROUP BY lower(email) HAVING count(*) > 1) d;

-- statement
SELECT 'E1-ids' AS check_id, array_agg(id ORDER BY id) AS user_ids
FROM public.users GROUP BY lower(email) HAVING count(*) > 1 ORDER BY min(id) LIMIT 100;

-- statement
SELECT 'E2' AS check_id,
       (SELECT count(*) FROM public.users WHERE email <> lower(btrim(email)))::bigint AS rows,
       (SELECT array_agg(id ORDER BY id) FROM (SELECT id FROM public.users WHERE email <> lower(btrim(email)) ORDER BY id LIMIT 100) s) AS first_user_ids;

-- statement
SELECT 'E3' AS check_id, count(*)::bigint AS rows FROM public.users WHERE email <> btrim(email);

-- statement
SELECT 'E4' AS check_id, count(*)::bigint AS rows FROM public.users WHERE email ~ '[^\x01-\x7e]';

-- statement
-- (dynamic SQL so the file also runs where the PO-02A invitation table does not exist yet: NULL there)
SELECT 'E5' AS check_id,
       CASE WHEN to_regclass('public.organization_invitations') IS NULL THEN NULL
            ELSE (xpath('/row/n/text()', query_to_xml(
                   'SELECT count(*) AS n FROM public.organization_invitations i
                    WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL
                      AND EXISTS (SELECT 1 FROM public.users u WHERE lower(u.email) = i.owner_email_normalized)',
                   false, true, '')))[1]::text::bigint END AS pending_conflicts;

-- statement
SELECT 'E6' AS check_id, c.reltuples::bigint AS estimated_rows, pg_relation_size(c.oid) AS heap_bytes,
       pg_total_relation_size(c.oid) AS total_bytes
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'users';

-- statement
ROLLBACK;
