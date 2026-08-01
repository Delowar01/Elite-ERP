import "server-only";

// Render an existing /print/[type]/[id] page to a PDF using headless Chromium — so the downloaded
// PDF is byte-for-byte the same layout the print view already produces (Arabic/RTL, logos, terms,
// bank accounts, seal/signature, per-org theme all preserved). One shared implementation for every
// document type; no per-document PDF code. The print page hides its toolbar under @media print and
// declares @page A4 margins, both of which page.pdf()'s print emulation honors.
//
// Chromium must be available at runtime (playwright + `npx playwright install chromium`, or a system
// chromium via PLAYWRIGHT_BROWSERS_PATH / CHROMIUM_EXECUTABLE_PATH). Any failure throws so the route
// returns an error and the UI never downloads an empty/corrupt file.
// Load playwright at runtime from node_modules, outside the webpack graph (it is external, not
// bundled). eval("require") keeps the bundler from trying to trace/chunk playwright's large tree.
type Chromium = { launch: (opts: unknown) => Promise<{ newContext: (o: unknown) => Promise<{ newPage: () => Promise<{ goto: (u: string, o: unknown) => Promise<{ ok: () => boolean; status: () => number } | null>; pdf: (o: unknown) => Promise<Buffer> }> }>; close: () => Promise<void> }> };
function loadChromium(): Chromium {
  const nodeRequire = eval("require") as NodeRequire;
  return (nodeRequire("playwright") as { chromium: Chromium }).chromium;
}

export async function renderPrintPagePdf(url: string, cookieHeader: string): Promise<Buffer> {
  const chromium = loadChromium();
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const context = await browser.newContext(cookieHeader ? { extraHTTPHeaders: { Cookie: cookieHeader } } : {});
    const page = await context.newPage();
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    if (!resp || !resp.ok()) throw new Error(`Print page returned status ${resp?.status() ?? "no response"}`);
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    if (!pdf || pdf.length < 1000) throw new Error("Generated PDF is empty.");
    return pdf;
  } finally {
    await browser.close().catch(() => {});
  }
}
