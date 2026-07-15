import { Badge, type badgeVariants } from "./badge";
import type { VariantProps } from "class-variance-authority";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

// Single source of truth for status -> color across every module, the same way the mockup's
// STATUS_PILL_CLASS dict was. Extend this as document statuses (Paid/Overdue/Sent/...) land —
// callers never hardcode a variant next to a status string themselves.
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: "success",
  archived: "neutral",
  deleted: "danger",
  draft: "neutral",
  pending: "warning",
  sent: "info",
  paid: "success",
  partial: "info",
  overdue: "danger",
  confirmed: "info",
  fulfilled: "success",
  cancelled: "danger",
  rejected: "danger",
  accepted: "success",
  expired: "neutral",
};

export function StatusBadge({ status, live }: { status: string; live?: boolean }) {
  const variant = STATUS_VARIANT[status.toLowerCase()] ?? "neutral";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <Badge variant={variant} live={live}>
      {label}
    </Badge>
  );
}
