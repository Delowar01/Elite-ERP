// Small client-safe helpers shared by the Platform Owner console components (PO-01B).

/** Next.js delivers a server-action redirect as navigation; if it ever surfaces as an error, it carries this digest. */
export function isRedirect(err: unknown): boolean {
  return typeof err === "object" && err !== null && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "PO"
  );
}
