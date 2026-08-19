/* ═══════════════════════════════════════════════════════════════════════════
   animation.js — data-driven entry sequencing (Doc 09).
   Elements declare data-anim="fade|fade-up|fade-down|fade-start|scale-in|
   pop|rise|draw" and data-anim-order="1…n". When a slide activates, each
   rank enters 120ms after the previous one, in the mandated order
   (background → header → headline → text → hero → screen → callouts → strip).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const BASE_DELAY = 160;   // ms before rank 1 fires, letting the slide fade begin
  const STEP = 120;         // ms between ranks (Doc 09 consistency)

  function resetSlide(slide) {
    slide.querySelectorAll('[data-anim]').forEach(function (el) {
      el.classList.remove('in');
      el.style.transitionDelay = '';
    });
  }

  function playSlide(slide) {
    const els = slide.querySelectorAll('[data-anim]');
    els.forEach(function (el) { el.classList.remove('in'); el.style.transitionDelay = ''; });
    // force style flush so re-entry replays from the hidden state
    void slide.offsetWidth;
    els.forEach(function (el) {
      const order = parseInt(el.getAttribute('data-anim-order') || '1', 10);
      el.style.transitionDelay = (BASE_DELAY + (order - 1) * STEP) + 'ms';
      el.classList.add('in');
    });
    // clear delays once the sequence has finished so hover/other transitions stay snappy
    const maxOrder = Math.max.apply(null, Array.prototype.map.call(els, function (el) {
      return parseInt(el.getAttribute('data-anim-order') || '1', 10);
    }).concat([1]));
    window.setTimeout(function () {
      els.forEach(function (el) { el.style.transitionDelay = ''; });
    }, BASE_DELAY + maxOrder * STEP + 700);
  }

  /* KPI count-up (Doc 09 §9) — elements declare data-count-to="34.6"
     data-count-suffix="%" etc. Used from slide 05 onward; wired now so the
     engine is complete. Numbers render LTR via the .num class. */
  function runCounters(slide) {
    slide.querySelectorAll('[data-count-to]').forEach(function (el) {
      const target = parseFloat(el.getAttribute('data-count-to'));
      const decimals = (el.getAttribute('data-count-to').split('.')[1] || '').length;
      const prefix = el.getAttribute('data-count-prefix') || '';
      const suffix = el.getAttribute('data-count-suffix') || '';
      const dur = 1000; // --t-kpi
      const t0 = performance.now();
      function frame(t) {
        const p = Math.min((t - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = prefix + (target * eased).toFixed(decimals) + suffix;
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  document.addEventListener('slidechange', function (e) {
    if (e.detail.previous) resetSlide(e.detail.previous);
    playSlide(e.detail.slide);
    runCounters(e.detail.slide);
  });
})();
