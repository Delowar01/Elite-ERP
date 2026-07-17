/* ═══════════════════════════════════════════════════════════════════════════
   app.js — boot: stage scaling, EN/AR language engine (mockup pattern:
   data-i18n-en / data-i18n-ar + RTL dir + screenshot swap), loading screen.
   English is the default launch language; Arabic persists via localStorage.
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

  /* ── Language engine ────────────────────────────────────────────────────── */
  function translateAll(lang) {
    document.querySelectorAll('[data-i18n-en]').forEach(function (el) {
      const value = lang === 'ar' ? el.getAttribute('data-i18n-ar') : el.getAttribute('data-i18n-en');
      if (value !== null) el.innerHTML = value;
    });
  }

  function swapScreens(lang) {
    document.querySelectorAll('img[data-src-en]').forEach(function (img) {
      const src = lang === 'ar' ? img.getAttribute('data-src-ar') : img.getAttribute('data-src-en');
      if (src && img.getAttribute('src') !== src) img.setAttribute('src', src);
    });
  }

  function setLanguage(lang) {
    const rtl = lang === 'ar';
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    translateAll(lang);
    swapScreens(lang);
    document.querySelectorAll('#btn-lang .lang-half').forEach(function (half) {
      half.classList.toggle('on', half.getAttribute('data-lang') === lang);
    });
    try { localStorage.setItem('eliteErpPresentationLang', lang); } catch (e) {}
  }
  window.setLanguage = setLanguage;

  document.getElementById('btn-lang').addEventListener('click', function () {
    const nextLang = document.documentElement.getAttribute('lang') === 'ar' ? 'en' : 'ar';
    setLanguage(nextLang);
  });

  /* ── Boot ───────────────────────────────────────────────────────────────── */
  let lang = 'en'; // English is the default launch language
  try {
    const stored = localStorage.getItem('eliteErpPresentationLang');
    if (stored === 'ar' || stored === 'en') lang = stored;
  } catch (e) {}

  fitStage();
  setLanguage(lang);
  window.Presentation.init();

  /* Loading screen: dismiss once fonts + first assets are ready */
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
