-- =============================================================================================
-- PROPOSAL (PO-02D0) — TEMPLATE — NOT APPROVED · NOT EXECUTED · DELIBERATELY NOT VALID SQL.
-- Every <<APPROVED:…>> token must be replaced by an OWNER-APPROVED value (decisions T-1…T-4, T-6 in
-- PO02D0_DECISIONS.md §D) before PO-02D1 may turn this into drizzle/platform/PO02D1_seed.sql. No value
-- here is a decision: 14 days is only the specification's proposal; seats, storage and module labels
-- have NO proposed value and must not be invented.
--
-- Creates exactly: the platform_settings row (id = 1); the default Trial package (code 'trial');
-- its version 1, PUBLISHED, SAR 0.00 / 0.00; one platform audit record of the seeding. Nothing for any
-- customer company: no subscription, no primary owner, no access row, no invitation.
-- Retry-safe: absent -> inserted; present with exactly the approved values -> verified; present with
-- different values -> abort (a published version is immutable anyway; the guard trigger refuses edits).
-- =============================================================================================
\set ON_ERROR_STOP on
BEGIN;
DO $proposal_guard$ BEGIN
  RAISE EXCEPTION 'PO-02D0 PROPOSAL — not approved for execution (docs/platform-owner/PO02D0_DECISIONS.md §G)';
END $proposal_guard$;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $seed$
DECLARE
  s record;
  p record;
  v record;
  approved_modules jsonb := <<APPROVED:trial_module_groups_json_array>>::jsonb;  -- e.g. a list of labels; decision P-6
BEGIN
  -- platform_settings (singleton)
  SELECT * INTO s FROM public.platform_settings WHERE id = 1;
  IF NOT FOUND THEN
    INSERT INTO public.platform_settings (id, default_trial_days, grace_days, expiry_alerts_enabled)
    VALUES (1, <<APPROVED:default_trial_days>>, <<APPROVED:grace_days>>, <<APPROVED:expiry_alerts_enabled>>);
  ELSIF s.default_trial_days <> <<APPROVED:default_trial_days>> OR s.grace_days <> <<APPROVED:grace_days>>
        OR s.expiry_alerts_enabled <> <<APPROVED:expiry_alerts_enabled>> THEN
    RAISE EXCEPTION 'PO-02D1 seed: platform_settings differs from the approved values; nothing was applied';
  END IF;

  -- default Trial package
  SELECT * INTO p FROM public.subscription_packages WHERE code = 'trial';
  IF NOT FOUND THEN
    INSERT INTO public.subscription_packages (code, name, description, status, is_trial, is_default_trial)
    VALUES ('trial', 'Trial', NULL, 'active', true, true)
    RETURNING * INTO p;
  ELSIF NOT (p.is_trial AND p.is_default_trial AND p.status = 'active') THEN
    RAISE EXCEPTION 'PO-02D1 seed: the trial package exists in an unexpected state; nothing was applied';
  END IF;

  -- its version 1, published (the guard trigger forbids any later change)
  SELECT * INTO v FROM public.subscription_package_versions WHERE package_id = p.id AND version_number = 1;
  IF NOT FOUND THEN
    INSERT INTO public.subscription_package_versions
      (package_id, is_trial, version_number, publish_state, currency_code, monthly_price, annual_price,
       included_seats, storage_allowance_gb, module_groups, trial_days, published_at)
    VALUES (p.id, true, 1, 'published', 'SAR', 0, 0,
            <<APPROVED:trial_included_seats>>, <<APPROVED:trial_storage_allowance_gb>>, approved_modules,
            <<APPROVED:trial_days>>, now())
    RETURNING * INTO v;
    INSERT INTO public.platform_audit_events (actor_platform_admin_id, actor_label, action, entity_type, entity_id, after_safe, result)
    VALUES (NULL, 'migration PO-02D1', 'package.trial_seeded', 'subscription_package_version', v.id::text,
            jsonb_build_object('packageCode', 'trial', 'version', 1, 'trialDays', v.trial_days, 'seats', v.included_seats,
                               'storageGb', v.storage_allowance_gb, 'moduleGroups', v.module_groups, 'currency', 'SAR', 'price', 0),
            'success');
  ELSIF v.publish_state <> 'published' OR v.trial_days <> <<APPROVED:trial_days>>
        OR v.included_seats <> <<APPROVED:trial_included_seats>> OR v.storage_allowance_gb <> <<APPROVED:trial_storage_allowance_gb>>
        OR v.module_groups <> approved_modules OR v.monthly_price <> 0 OR v.annual_price <> 0 THEN
    RAISE EXCEPTION 'PO-02D1 seed: trial version 1 differs from the approved values; nothing was applied';
  END IF;
END
$seed$;

COMMIT;
