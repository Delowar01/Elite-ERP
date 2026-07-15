import { RiyalSymbol } from "@/components/ui/riyal-symbol";
import { fmt } from "./totals";

// Matches the mockup's sar(n) helper exactly: f"{RIYAL_SIGN_SVG} SAR {n:,.2f}"
export function Money({ amount, className }: { amount: string | number; className?: string }) {
  return (
    <span className={className}>
      <RiyalSymbol /> SAR {fmt(amount)}
    </span>
  );
}
