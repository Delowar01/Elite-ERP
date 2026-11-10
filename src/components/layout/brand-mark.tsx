import { LogoMark } from "@/components/brand/logo-mark";

// The organization's mark in the LCP brand slot (header, sidebar footer, drawer): the uploaded logo on
// a white plate (logos are designed for white paper), otherwise the Elite mark on the LCP primary tile
// in the contrast-validated on-primary ink. Decorative — the organization name always sits beside it.
export function BrandMark({ orgLogoUrl, size = "md" }: { orgLogoUrl: string | null; size?: "md" | "lg" }) {
  if (orgLogoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={orgLogoUrl} alt="" className="brand-mark brand-mark-logo" data-size={size} />;
  }
  return (
    <span className="brand-mark brand-mark-tile" data-size={size} aria-hidden="true">
      <LogoMark size={size === "lg" ? 22 : 20} color="var(--primary-foreground)" />
    </span>
  );
}
