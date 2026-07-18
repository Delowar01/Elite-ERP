import Link from "next/link";

// Root not-found: catches unmatched paths outside the app shell (e.g. a bad /print URL).
// Standalone, no shell — it renders inside the root layout only.
export default function RootNotFound() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--canvas)", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <div style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 64, fontWeight: 800, color: "var(--brand-orange)", lineHeight: 1 }}>404</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "16px 0 8px", color: "var(--ink)" }}>Page not found</h1>
        <p style={{ color: "var(--ink-muted)", fontSize: 14, margin: "0 0 24px" }}>
          The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved.
        </p>
        <Link href="/dashboard" className="btn btn-primary" style={{ width: "auto", padding: "0 18px", display: "inline-flex" }}>
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
