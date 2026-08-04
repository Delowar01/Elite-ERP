import "server-only";

// Render an existing /print/[type]/[id] page to a PDF using headless Chromium — so the downloaded
// PDF is byte-for-byte the same layout the print view already produces (Arabic/RTL, logos, terms,
// bank accounts, seal/signature, per-org theme all preserved). One shared implementation for every
// document type; no per-document PDF code.
//
// Engine: puppeteer-core + @sparticuz/chromium. This is the standard combination that runs inside
// serverless / Vercel functions (where a full Playwright Chromium download does NOT fit and fails —
// the original cause of "Download failed" in production). Locally / on a VPS, set
// CHROMIUM_EXECUTABLE_PATH to a Chrome/Chromium binary and it is used directly.

type PdfPage = {
  setExtraHTTPHeaders: (headers: Record<string, string>) => Promise<void>;
  goto: (url: string, opts: unknown) => Promise<{ ok: () => boolean; status: () => number } | null>;
  pdf: (opts: unknown) => Promise<Uint8Array>;
};
type PdfBrowser = { newPage: () => Promise<PdfPage>; close: () => Promise<void> };
type Puppeteer = { launch: (opts: unknown) => Promise<PdfBrowser> };

async function launchBrowser(): Promise<PdfBrowser> {
  const puppeteer = ((await import("puppeteer-core")) as unknown as { default: Puppeteer }).default;
  const explicitPath = process.env.CHROMIUM_EXECUTABLE_PATH;
  const isServerless =
    !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.AWS_EXECUTION_ENV || !!process.env.VERCEL;

  // Serverless (Vercel/Lambda): use @sparticuz/chromium-min, which bundles NO binary — it downloads
  // the Chromium + system-library pack (including libnss3.so) at runtime and extracts it to /tmp.
  // This sidesteps Vercel's output file tracing, which was dropping the bundled binary/lib packs and
  // producing "libnss3.so: cannot open shared object file". The pack URL is a pinned @sparticuz
  // GitHub release; override with CHROMIUM_PACK_URL (e.g. a self-hosted copy) if GitHub is blocked.
  if (!explicitPath && isServerless) {
    const chromium = ((await import("@sparticuz/chromium-min")) as unknown as {
      default: { args: string[]; defaultViewport: unknown; executablePath: (pack?: string) => Promise<string>; setGraphicsMode: boolean };
    }).default;
    // PDF rendering needs no WebGL/GPU, so skip the swiftshader graphics stack (smaller, faster).
    chromium.setGraphicsMode = false;
    const packUrl =
      process.env.CHROMIUM_PACK_URL ||
      "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar";
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(packUrl),
      headless: true,
    });
  }

  // Local / VPS: a Chromium binary provided via env.
  return puppeteer.launch({
    executablePath: explicitPath || undefined,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

export async function renderPrintPagePdf(url: string, cookieHeader: string): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    if (cookieHeader) await page.setExtraHTTPHeaders({ Cookie: cookieHeader });
    const resp = await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
    if (!resp || !resp.ok()) throw new Error(`Print page returned status ${resp?.status() ?? "no response"}`);
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    const buf = Buffer.from(pdf);
    if (buf.length < 1000) throw new Error("Generated PDF is empty.");
    return buf;
  } finally {
    await browser.close().catch(() => {});
  }
}
