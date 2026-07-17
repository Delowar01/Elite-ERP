/* ═══════════════════════════════════════════════════════════════════════════
   navigation.js — every input mode the spec mandates (Doc 03 §9, Doc 09 §11):
   keyboard, mouse wheel, prev/next buttons, clickable progress dots,
   touch swipe, full-screen, chrome hide (H), deep links (#slide-NN).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const P = window.Presentation;

  /* ── Keyboard ───────────────────────────────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        e.preventDefault(); P.next(); break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault(); P.prev(); break;
      case 'Home': e.preventDefault(); P.first(); break;
      case 'End': e.preventDefault(); P.last(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'h': case 'H': document.body.classList.toggle('chrome-hidden'); break;
      default: break;
    }
  });

  /* ── Mouse wheel (throttled so one gesture = one slide) ─────────────────── */
  let wheelLockUntil = 0;
  window.addEventListener('wheel', function (e) {
    const now = Date.now();
    if (now < wheelLockUntil) return;
    if (Math.abs(e.deltaY) < 24) return;
    wheelLockUntil = now + 850;
    if (e.deltaY > 0) P.next(); else P.prev();
  }, { passive: true });

  /* ── Touch swipe ────────────────────────────────────────────────────────── */
  let touchX = null;
  window.addEventListener('touchstart', function (e) {
    touchX = e.changedTouches[0].clientX;
  }, { passive: true });
  window.addEventListener('touchend', function (e) {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) < 56) return;
    const rtl = document.documentElement.getAttribute('dir') === 'rtl';
    const forward = rtl ? dx > 0 : dx < 0;
    if (forward) P.next(); else P.prev();
  }, { passive: true });

  /* ── Buttons & dots ─────────────────────────────────────────────────────── */
  document.getElementById('btn-prev').addEventListener('click', function () { P.prev(); });
  document.getElementById('btn-next').addEventListener('click', function () { P.next(); });
  document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(function () {});
    }
  }

  function buildDots(total) {
    const holder = document.getElementById('progress-dots');
    holder.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('button');
      dot.className = 'dot';
      dot.setAttribute('aria-label', 'Go to slide ' + (i + 1));
      dot.addEventListener('click', (function (idx) {
        return function () { P.go(idx); };
      })(i));
      holder.appendChild(dot);
    }
  }

  function refreshChrome(index, total) {
    const dots = document.querySelectorAll('#progress-dots .dot');
    dots.forEach(function (d, i) { d.classList.toggle('on', i === index); });
    document.getElementById('slide-counter').innerHTML =
      '<b>' + String(index + 1).padStart(2, '0') + '</b> / ' + String(total).padStart(2, '0');
  }

  document.addEventListener('slidechange', function (e) {
    if (document.querySelectorAll('#progress-dots .dot').length !== e.detail.total) {
      buildDots(e.detail.total);
    }
    refreshChrome(e.detail.index, e.detail.total);
  });
})();
