/**
 * DEV-UI-01.4-C1 — `next/link` for the control-gallery bundle only (esbuild `alias`). The real Link
 * needs the Next runtime (it reads `process.env` at module load); the gallery renders the shared
 * RowMenu with entries that have no `href`, so Link is imported but never rendered. A plain anchor
 * keeps the import resolvable. Never part of the application build.
 */
import type { AnchorHTMLAttributes } from "react";

export default function Link({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a href={href} {...props} />;
}
