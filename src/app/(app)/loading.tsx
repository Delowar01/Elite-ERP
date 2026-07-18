// Route-level loading fallback shown during server-component data fetches. A trio of skeleton
// bars keeps the shell stable while the page streams in — quiet, brand-neutral, theme-aware.
export default function AppLoading() {
  return (
    <div className="max-w-6xl mx-auto animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-48 rounded-lg mb-6" style={{ background: "var(--line)" }} />
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-2xl" style={{ background: "var(--line)" }} />
        ))}
      </div>
      <div className="h-64 rounded-2xl" style={{ background: "var(--line)" }} />
    </div>
  );
}
