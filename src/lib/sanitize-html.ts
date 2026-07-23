// Minimal allowlist HTML sanitizer for rich-text note / item-description fields. No external
// dependency (this codebase deliberately avoids adding parsers to the security surface). It keeps a
// small set of inline/formatting tags and strips everything else — all attributes except a safe
// href on <a> — so stored rich text can be rendered with dangerouslySetInnerHTML without XSS risk.
// Runs identically on the server (authoritative, on save) and the client (preview).

const ALLOWED_TAGS = new Set(["b", "strong", "i", "em", "u", "br", "p", "ul", "ol", "li", "a", "span"]);
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

// Strip tags/attributes not in the allowlist. Also caps length to avoid unbounded storage.
export function sanitizeRichText(input: string, maxLen = 20000): string {
  if (!input) return "";
  let out = "";
  let i = 0;
  const s = input.slice(0, maxLen);
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt === -1) {
      out += escapeText(s.slice(i));
      break;
    }
    out += escapeText(s.slice(i, lt));
    const gt = s.indexOf(">", lt);
    if (gt === -1) {
      out += escapeText(s.slice(lt));
      break;
    }
    const rawTag = s.slice(lt + 1, gt).trim();
    out += renderTag(rawTag);
    i = gt + 1;
  }
  return out;
}

function renderTag(rawTag: string): string {
  const closing = rawTag.startsWith("/");
  const name = (closing ? rawTag.slice(1) : rawTag).split(/[\s/]/)[0].toLowerCase();
  if (!ALLOWED_TAGS.has(name)) return ""; // drop disallowed tag entirely (its text content survives)
  if (closing) return `</${name}>`;
  if (name === "a") {
    const href = extractHref(rawTag);
    if (href && SAFE_URL.test(href)) {
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noreferrer nofollow">`;
    }
    return "<a>";
  }
  return `<${name}>`;
}

function extractHref(rawTag: string): string | null {
  const m = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(rawTag);
  if (!m) return null;
  return (m[2] ?? m[3] ?? m[4] ?? "").trim();
}

function escapeText(t: string): string {
  return t.replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Convert stored content to safe HTML for rendering. Legacy plain-text notes (no tags) get their
// newlines turned into <br> so they still render with line breaks.
export function richTextToHtml(input: string | null | undefined): string {
  if (!input) return "";
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(input);
  const clean = sanitizeRichText(input);
  if (looksLikeHtml) return clean;
  return clean.replace(/\r?\n/g, "<br>");
}

// Store-side helper: sanitize only when the value actually contains HTML (came from the rich-text
// editor); otherwise return the trimmed raw text unchanged. This keeps plain values un-escaped in
// storage so richTextToHtml escapes them exactly once at render (no double-escaping).
export function sanitizeIfHtml(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = input.trim();
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(trimmed);
  return looksLikeHtml ? sanitizeRichText(trimmed) : trimmed;
}

// Plain-text projection of rich text (for places that must stay text: PDF layout, list previews).
export function richTextToPlain(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
