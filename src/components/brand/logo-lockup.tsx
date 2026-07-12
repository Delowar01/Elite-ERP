import { LogoMark } from "./logo-mark";

export function LogoLockup({ ink = "#FFFFFF", size = 28 }: { ink?: string; size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={size} color={ink} />
      <div className="leading-none">
        <div className="font-display font-extrabold tracking-tight" style={{ color: ink, fontSize: size * 0.68 }}>
          ELITE
        </div>
        <div
          className="font-medium mt-0.5"
          style={{ color: ink, fontSize: size * 0.24, letterSpacing: "0.17em" }}
        >
          INNOVATION SOLUTIONS
        </div>
      </div>
    </div>
  );
}
