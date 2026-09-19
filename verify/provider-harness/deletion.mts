/**
 * "Is the former public URL still serving the bytes?", decided fail-closed.
 *
 * The tempting shape is `try { probe() } catch { return "gone" }`: an exception becomes proof of
 * deletion. It is the same fail-open mistake already removed from probeAnonymous(). An exception
 * means the provider was not reached, which is not an answer about the object. It also inverts the
 * incentive — the worse the network, the better the security evidence looks.
 *
 * Two further conditions make the question answerable at all:
 *   - the object must have been anonymously READABLE before the delete, otherwise "not readable
 *     afterwards" describes a URL that never worked rather than a change the delete caused;
 *   - authenticated absence must already be established, otherwise the object is still there and
 *     the public-URL question is moot.
 *
 * Only a provider that actually answered, having been readable before, can turn this into evidence.
 */
export type ProbeState = "readable" | "denied" | "not_found";
export type ProbeAnswer =
  | { kind: "answered"; state: ProbeState; status?: number }
  | { kind: "unreachable"; error: unknown };

export type PostDeletionOutcome = {
  passed: boolean | null;
  classification: "REAL PROVIDER PROVEN" | "NOT RUN / NOT PROVEN";
  detail: string;
};

export function classifyPostDeletionPublicUrl(input: {
  baseline: ProbeState;
  authenticatedAbsence: boolean;
  probe: ProbeAnswer;
  redactError?: (e: unknown) => string;
}): PostDeletionOutcome {
  const { baseline, authenticatedAbsence, probe } = input;
  const show = input.redactError ?? ((e: unknown) => (e instanceof Error ? e.message : String(e)));

  if (!authenticatedAbsence) {
    return { passed: null, classification: "NOT RUN / NOT PROVEN", detail: "skipped: the object is still present under authentication, so the public-URL question is moot" };
  }
  if (baseline !== "readable") {
    return { passed: null, classification: "NOT RUN / NOT PROVEN", detail: `INCONCLUSIVE — the URL was already ${baseline} before the delete, so its state afterwards proves no change` };
  }
  if (probe.kind === "unreachable") {
    return { passed: null, classification: "NOT RUN / NOT PROVEN", detail: `INCONCLUSIVE — the provider did not answer: ${show(probe.error)}` };
  }
  if (probe.state === "readable") {
    return { passed: false, classification: "REAL PROVIDER PROVEN", detail: `SECURITY DEFECT: still readable (status ${probe.status}) after an authenticated absence` };
  }
  return { passed: true, classification: "REAL PROVIDER PROVEN", detail: `was readable before; anonymous ${probe.state} (${probe.status}) with authenticated absence established` };
}
