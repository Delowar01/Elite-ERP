"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

// App-group error boundary (Client Component per Next.js). No i18n hook here — errors can occur
// before locale context resolves, so the copy is kept in plain English to stay dependency-free.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="max-w-md mx-auto text-center py-20">
      <div
        className="mx-auto mb-5 flex items-center justify-center rounded-2xl"
        style={{ width: 56, height: 56, background: "var(--danger-bg)", border: "1px solid var(--line)" }}
      >
        <AlertTriangle className="size-7" style={{ color: "var(--danger)" }} />
      </div>
      <h3 className="text-[19px] font-bold mb-2">Something went wrong</h3>
      <p className="text-ink-muted text-sm mb-6">An unexpected error occurred. You can try again, or head back to your dashboard.</p>
      <div className="flex items-center justify-center gap-2.5">
        <button type="button" onClick={reset} className="btn btn-primary" style={{ width: "auto", padding: "0 18px" }}>
          Try again
        </button>
        <Link href="/dashboard" className="btn btn-glass" style={{ width: "auto", padding: "0 18px", display: "inline-flex" }}>
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
