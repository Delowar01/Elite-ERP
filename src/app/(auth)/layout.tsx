import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getSession } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/auth";

// Server Component. The edge middleware no longer redirects auth routes on cookie *presence*
// (that was the B1 loop), so the decision is made here with a FULL check that includes
// server-side revocation:
//   - genuinely usable session   -> go to /dashboard (preserves the "already logged in" UX)
//   - present-but-unusable cookie -> clear it via /auth/clear, then this page renders
//   - no cookie                  -> render the login/register form
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const store = await cookies();
  if (store.get(SESSION_COOKIE)) {
    const path = (await headers()).get("x-pathname");
    const next = path === "/register" ? "/register" : "/login";
    redirect(`/auth/clear?next=${next}`);
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6 py-16"
      style={{
        background:
          "radial-gradient(ellipse 700px 420px at 50% -10%, rgba(232,119,34,0.14), transparent 60%), var(--canvas)",
      }}
    >
      {children}
    </div>
  );
}
