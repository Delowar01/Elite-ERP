/**
 * The disposable test organization's email address, canonicalized.
 *
 * Registration stores `String(formData.get("email")).trim().toLowerCase()` (see
 * src/app/(auth)/actions.ts), so the address the database holds is not necessarily the address the
 * harness typed. A run id contains an ISO timestamp — `2026-09-19T02:44:06.369Z` — and the label is
 * "A" or "B", so the submitted address carries uppercase that the row does not. PostgreSQL text
 * equality is case-sensitive, so `select org_id from users where email = $1` found nothing,
 * registration "failed" for a run in which it had actually succeeded, and the manifest recorded an
 * ownership locator that matched no row — which then broke cleanup too.
 *
 * The fix belongs here rather than in the query. Answering with LOWER(email), ILIKE or a pattern
 * would turn an exact single-row locator into a fuzzy match, in the one place that is allowed to
 * delete an organization. One canonical string is generated once and used for the form, the lookup,
 * the manifest and cleanup alike.
 */
export function testOrgEmail(label: string, runId: string): string {
  return `batch3-${label}-${runId}@example.invalid`.trim().toLowerCase();
}

/** How registration canonicalizes an address, mirrored so tests can assert the two agree. */
export function canonicalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
