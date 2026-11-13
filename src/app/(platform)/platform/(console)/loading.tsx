import { Delayed, Skeleton } from "@/components/ui/skeleton";

// Shared loading placeholder for the console sections: a header, a row of tiles and a panel — the
// shape every section page renders. Delayed, so a fast response never paints it.
export default function PlatformConsoleLoading() {
  return (
    <Delayed>
      <div className="platform-page animate-pulse" aria-busy="true" role="status">
        <span className="sr-only" lang="en">Loading…</span>
        <span className="sr-only" lang="ar">جارٍ التحميل…</span>
        <Skeleton className="h-7 w-56 mb-2" />
        <Skeleton className="h-4 w-80 mb-6" />
        <div className="platform-stat-grid">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl mt-6" />
      </div>
    </Delayed>
  );
}
