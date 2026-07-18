/* ═══════════════════════════════════════════════════════════════════════════
   app.js — boot: stage scaling + loading screen.
   English-only build. (Arabic/RTL support returns in a future version —
   see docs/PRESENTATION_IMPLEMENTATION_PLAN.md.)
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Proportional 16:9 stage scaling ────────────────────────────────────── */
  const STAGE_W = 1920;
  const STAGE_H = 1080;
  function fitStage() {
    const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    document.getElementById('stage').style.setProperty('--stage-scale', scale);
  }
  window.addEventListener('resize', fitStage);
  fitStage();

  window.Presentation.init();

  /* ── Loading screen: dismiss once fonts + first assets are ready ─────────── */
  function dismissLoader() {
    document.getElementById('loader').classList.add('done');
  }
  Promise.all([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    new Promise(function (resolve) {
      if (document.readyState === 'complete') resolve();
      else window.addEventListener('load', resolve, { once: true });
    }),
  ]).then(function () { window.setTimeout(dismissLoader, 250); });
  window.setTimeout(dismissLoader, 3500); // hard cap — never trap a live keynote
})();
