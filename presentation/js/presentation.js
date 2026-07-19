/* ═══════════════════════════════════════════════════════════════════════════
   presentation.js — slide registry + state machine.
   Owns which slide is active; everything else (animation, chrome, hash)
   reacts to the 'slidechange' event it dispatches.
   ═══════════════════════════════════════════════════════════════════════════ */
window.Presentation = (function () {
  'use strict';

  let slides = [];
  let current = -1;
  let locked = false;

  function count() { return slides.length; }
  function index() { return current; }

  function go(target, opts) {
    opts = opts || {};
    if (target < 0 || target >= slides.length) return;
    if (target === current) return;
    if (locked && !opts.force) return;

    const prev = current >= 0 ? slides[current] : null;
    const next = slides[target];
    current = target;

    if (prev) {
      prev.classList.add('leaving');
      prev.classList.remove('active');
      window.setTimeout(function () { prev.classList.remove('leaving'); }, 700);
    }
    next.classList.add('active');

    locked = true;
    window.setTimeout(function () { locked = false; }, 340);

    try { history.replaceState(null, '', '#slide-' + String(target + 1).padStart(2, '0')); } catch (e) {}

    document.dispatchEvent(new CustomEvent('slidechange', {
      detail: { index: target, slide: next, previous: prev, total: slides.length },
    }));
  }

  function next() { go(current + 1); }
  function prev() { go(current - 1); }
  function first() { go(0); }
  function last() { go(slides.length - 1); }

  function init() {
    slides = Array.prototype.slice.call(document.querySelectorAll('#stage > .slide'));
    const m = (location.hash || '').match(/slide-(\d+)/);
    let start = m ? parseInt(m[1], 10) - 1 : 0;
    if (!(start >= 0 && start < slides.length)) start = 0;
    go(start, { force: true });
  }

  return { init: init, go: go, next: next, prev: prev, first: first, last: last, index: index, count: count };
})();
