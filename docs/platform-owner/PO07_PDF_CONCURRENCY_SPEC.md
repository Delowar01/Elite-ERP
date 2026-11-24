# PO-07 D7 — PDF render concurrency limiter: implementation specification and regression-test plan

**Status (24 Nov 2026): the design is approved (D7). It is a separate application-code workstream and is NOT
implemented.** The pinned staging release `cf64ebc` is not changed by this document. Implementation and verification
need their own approved release before any unrestricted public availability.

## 1. Why

Measured on the staging sandbox (customer unit `TasksMax=320`, `MemoryHigh=768M`, `MemoryMax=896M`):

| Renders at once | Customer tasks (peak) | Customer memory (peak) |
|---|---|---|
| 1 | about 150 | — |
| 2 | 247–254 | 444–463 MB |

Each Chromium render needs about 120 tasks. A third simultaneous render would hit the unit's task cap: `pthread_create`
fails, and that request errors inside the unit. The caps contain it, but the user gets a failure instead of a clear
answer. Today the application has no limit at all.

## 2. Behaviour (approved values)

| Setting | Value | Environment variable (default) |
|---|---|---|
| Concurrent renders per customer process | **2** | `PDF_MAX_CONCURRENT` (2) |
| Waiting requests (bounded queue) | **4** | `PDF_QUEUE_MAX` (4) |
| Longest wait in the queue | **15 s** | `PDF_QUEUE_WAIT_MS` (15000) |
| Beyond either limit | **HTTP 503**, `Retry-After: 10`, `Cache-Control: no-store` | — |

- **One limiter per Node.js process**, a module-level singleton in `src/lib/pdf/` that wraps the existing render call.
  It is not per tenant: the cap protects the process. Fairness: FIFO.
- **Acquire:** a render slot is taken before Chromium starts and released in a `finally` block, so success, error,
  timeout and client disconnect all release it.
- **Waiting:** a request waits in the queue while fewer than `PDF_QUEUE_MAX` are waiting. Otherwise it is rejected at
  once (503).
- **Queue timeout:** after `PDF_QUEUE_WAIT_MS` a waiting request is removed from the queue and gets 503.
- **Cancellation:** if the client disconnects while waiting, the entry is removed (an `AbortSignal` from the request).
  If it disconnects while rendering, the render is aborted (`page.close()` / `browser.close()`) and the slot released.
- **Render timeout:** the existing render timeout stays. A timed-out render releases its slot and returns the
  existing error.
- **No leak:** the 503 body and headers carry no queue length, tenant, user, document or timing information. The log
  line records the event, the queue depth and the wait in ms, never document data.

## 3. User-facing message (bilingual, project rule)

| | Text |
|---|---|
| English | "The PDF service is busy. Please try again in a few seconds." |
| Arabic | «خدمة ملفات PDF مشغولة حاليًا. يُرجى المحاولة مرة أخرى بعد بضع ثوانٍ.» |

The message is returned in the user's interface language (the existing locale mechanism). Where the client shows it
(the download button's error toast), it uses the existing toast component, is RTL-correct in Arabic, and keeps "PDF"
in LTR.

## 4. Regression-test plan (all with fictional data; the browser tier included)

1. **Unit tests (limiter):**
   - 2 slots: the 3rd acquire waits; the 7th is rejected at once (queue full);
   - a waiter times out after `PDF_QUEUE_WAIT_MS`;
   - an abort removes a waiter;
   - every release path frees the slot (success, throw, abort);
   - FIFO order;
   - no slot leaks after 1,000 random acquire/release/abort sequences.
2. **Route tests:**
   - `GET /api/document-pdf/...` returns `503 Retry-After: 10` with the bilingual body when the limiter rejects;
   - authorization is checked **before** queueing: an unauthorized request never takes or waits for a slot.
3. **Integration on the staging sandbox profile** (the S9 PDF probe, extended):
   - 1, 2, 3 and 6 concurrent renders: at most 2 render at once; the others wait or get 503; every response is either
     a valid PDF or a clean 503;
   - customer unit tasks stay below 90 % of `TasksMax` (288); no memory-high, memory-max or OOM event; no refused task.
4. **Cancellation:** clients that disconnect while queued or rendering leave no Chromium process and no held slot (the
   process count returns to idle).
5. **Bilingual UI:** the toast in English and in Arabic (RTL), light and dark themes, desktop and mobile widths. A
   Playwright assertion checks that the Arabic text matches the Arabic regex.
6. **No regression:** the existing PDF suites (branding, print, private storage) and the H-1 suite pass unchanged.

## 5. Rollout

- Ship behind its defaults (no switch needed: limiting is always on).
- Measure on staging with the S9 PDF probe, then include it in the next approved release.
- Unrestricted public availability stays **NO-GO** until this limiter is released and verified.
