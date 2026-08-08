// The dashboard's loading placeholder: a title, the four KPI cards and the overview block — which
// is what this page actually renders.
//
// This file used to sit at the route-group level, which meant it stood in for EVERY screen in the
// app, including nine-column document lists, where it flashed and then reflowed into something
// structurally unrelated. Lists now carry their own shaped placeholders; see
// components/ui/skeleton.tsx for the shape and delay rules, and the Task 7 commit for the list of
// routes deliberately left without one.
import { Delayed, Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <Delayed>
      <div className="max-w-6xl mx-auto animate-pulse" aria-busy="true" aria-label="Loading" role="status">
        <Skeleton className="h-7 w-48 mb-6" />
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </Delayed>
  );
}
