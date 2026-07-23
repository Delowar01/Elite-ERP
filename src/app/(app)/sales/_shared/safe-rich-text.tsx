import { richTextToHtml } from "@/lib/sanitize-html";

// Renders a stored note / item description (which may contain sanitized rich-text HTML, or legacy
// plain text) safely. Sanitization is re-applied here, so even values that predate the sanitizer or
// were written directly to the DB render without XSS risk.
export function SafeRichText({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return null;
  return <span className={`rich-html ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: richTextToHtml(value) }} />;
}
