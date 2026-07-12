export function LogoMark({ size = 28, color = "#FFFFFF", className }: { size?: number; color?: string; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="9" y="7" width="12" height="50" rx="6" fill={color} />
      <rect x="9" y="7" width="39" height="12" rx="6" fill={color} />
      <rect x="9" y="26" width="32" height="12" rx="6" fill={color} />
      <rect x="9" y="45" width="39" height="12" rx="6" fill={color} />
    </svg>
  );
}
