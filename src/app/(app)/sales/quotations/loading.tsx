// Loading placeholder for this list. The column count mirrors the real table so the skeleton does
// not reflow into a different shape when the data lands; `scratchpad/verify-skeletons.mjs` asserts
// the two stay equal. Nothing paints for the first 150ms (see TableSkeleton), so a fast response
// shows no placeholder at all.
import { TableSkeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <TableSkeleton columns={10} statCards={4} />;
}
