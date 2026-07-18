/**
 * Presentation QA suite — Phase 1 + Slides 01–04 (English-only design pass).
 * Asserts: clean load, slide registry, keyboard/button/dot/wheel navigation,
 * deep links, proportional 16:9 scaling, full-screen mode, chrome behavior,
 * persistent brand mark on every slide, no leftover Arabic/bilingual code.
 *
 * Usage: node presentation/tools/verify_presentation.js
 */
const { chromium } = require('playwright-core');
const path = require('path');

const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');
const SLIDES = 4;

let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!cond) failures++;
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(INDEX, { waitUntil: 'load' });

  console.log('Load & structure:');
  await page.waitForSelector('#loader.done', { timeout: 8000 });
  ok(true, 'loading screen dismissed');
  ok(errors.length === 0, `no JS/console errors (${errors.length ? errors.join(' | ') : 'clean'})`);
  const structure = await page.evaluate(() => ({
    slides: document.querySelectorAll('#stage > .slide').length,
    active: document.querySelector('.slide.active') ? document.querySelector('.slide.active').id : null,
    dots: document.querySelectorAll('#progress-dots .dot').length,
    lang: document.documentElement.getAttribute('lang'),
    dir: document.documentElement.getAttribute('dir'),
  }));
  ok(structure.slides === SLIDES, `${SLIDES} slides present (got ${structure.slides})`);
  ok(structure.active === 'slide-01', `slide-01 active on launch (got ${structure.active})`);
  ok(structure.dots === SLIDES, `progress dots built (${structure.dots})`);
  ok(structure.lang === 'en' && structure.dir === 'ltr', 'English LTR');

  console.log('English-only build (no bilingual leftovers):');
  ok(await page.evaluate(() => !document.getElementById('btn-lang')), 'no language-toggle button in DOM');
  ok(await page.evaluate(() => typeof window.setLanguage === 'undefined'), 'setLanguage() removed from app.js');
  const bodyText = await page.evaluate(() => document.body.textContent);
  ok(!/[؀-ۿ]/.test(bodyText), 'no Arabic characters anywhere in the document');
  ok(await page.evaluate(() =>
    document.querySelectorAll('[data-i18n-en],[data-i18n-ar],[data-src-ar]').length === 0
  ), 'no leftover data-i18n-*/data-src-ar attributes');

  console.log('Persistent brand mark (requirement: logo on every slide, consistent position):');
  const brandBox = await page.evaluate(() => {
    const el = document.getElementById('chrome-brand');
    const r = el.getBoundingClientRect();
    return { visible: getComputedStyle(el).display !== 'none' && r.width > 0, top: r.top, left: r.left };
  });
  ok(brandBox.visible, `brand mark rendered (${brandBox.left.toFixed(0)},${brandBox.top.toFixed(0)})`);
  for (let i = 0; i < SLIDES; i++) {
    const pos = await page.evaluate((idx) => {
      window.Presentation.go(idx, { force: true });
      const r = document.getElementById('chrome-brand').getBoundingClientRect();
      return { top: r.top, left: r.left, visible: r.width > 0 && getComputedStyle(document.getElementById('chrome-brand')).opacity !== '0' };
    }, i);
    ok(pos.visible && Math.abs(pos.top - brandBox.top) < 1 && Math.abs(pos.left - brandBox.left) < 1,
      `slide-${String(i + 1).padStart(2, '0')}: brand mark visible at identical position`);
  }
  await page.evaluate(() => window.Presentation.go(0, { force: true }));
  await page.waitForTimeout(400); // let the transition lock from the rapid-fire loop above clear
  // brand mark must survive chrome-hidden (identity, not nav clutter)
  await page.keyboard.press('h');
  await page.waitForTimeout(120);
  ok(await page.evaluate(() => {
    const r = document.getElementById('chrome-brand').getBoundingClientRect();
    return r.width > 0 && getComputedStyle(document.getElementById('chrome-brand')).opacity !== '0';
  }), 'brand mark stays visible when nav chrome is hidden (H)');
  await page.keyboard.press('h');

  console.log('Edge framing elements present:');
  ok(await page.evaluate(() => !!document.getElementById('edge-top-line')), 'top accent line present');
  ok(await page.evaluate(() => !!document.getElementById('edge-vignette')), 'edge vignette present');
  ok(await page.evaluate(() => !!document.getElementById('edge-corner-mark')), 'corner mark present');
  ok(await page.evaluate((n) => document.querySelectorAll('.ghost-num').length === n, SLIDES),
    'every slide has its ghost slide-number watermark');

  console.log('Keyboard navigation:');
  const activeId = () => page.evaluate(() => document.querySelector('.slide.active').id);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(450);
  ok(await activeId() === 'slide-02', 'ArrowRight advances to slide-02');
  ok(await page.evaluate(() => location.hash) === '#slide-02', 'hash deep-link updates (#slide-02)');
  await page.keyboard.press('Space');
  await page.waitForTimeout(450);
  ok(await activeId() === 'slide-03', 'Space advances to slide-03');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(450);
  ok(await activeId() === 'slide-02', 'ArrowLeft returns to slide-02');
  await page.keyboard.press('End');
  await page.waitForTimeout(450);
  ok(await activeId() === 'slide-04', 'End jumps to last slide');
  await page.keyboard.press('Home');
  await page.waitForTimeout(450);
  ok(await activeId() === 'slide-01', 'Home jumps to first slide');

  console.log('Pointer navigation:');
  await page.click('#btn-next');
  await page.waitForTimeout(450);
  ok(await activeId() === 'slide-02', 'next button advances');
  await page.click('#btn-prev');
  await page.waitForTimeout(450);
  ok(await activeId() === 'slide-01', 'prev button goes back');
  await page.click('#progress-dots .dot:nth-child(3)');
  await page.waitForTimeout(450);
  ok(await activeId() === 'slide-03', 'clicking dot 3 jumps to slide-03');
  await page.mouse.wheel(0, 160);
  await page.waitForTimeout(450);
  ok(await activeId() === 'slide-04', 'wheel scroll advances');
  const counter = await page.evaluate(() => document.getElementById('slide-counter').textContent);
  ok(/04\s*\/\s*04/.test(counter), `slide counter reflects position (${counter.trim()})`);

  console.log('Entry animation system:');
  const animState = await page.evaluate(() => {
    const els = document.querySelectorAll('.slide.active [data-anim]');
    return { total: els.length, entered: document.querySelectorAll('.slide.active [data-anim].in').length };
  });
  ok(animState.total > 0 && animState.entered === animState.total,
    `entry sequence completed on active slide (${animState.entered}/${animState.total} elements in)`);

  console.log('Proportional 16:9 scaling:');
  for (const vp of [{ w: 1280, h: 720 }, { w: 2560, h: 1440 }, { w: 1600, h: 1200 }]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.waitForTimeout(120);
    const s = await page.evaluate(() => {
      const stage = document.getElementById('stage');
      const rect = stage.getBoundingClientRect();
      return { scale: parseFloat(getComputedStyle(stage).getPropertyValue('--stage-scale')), w: rect.width, h: rect.height };
    });
    const expected = Math.min(vp.w / 1920, vp.h / 1080);
    ok(Math.abs(s.scale - expected) < 0.001, `${vp.w}×${vp.h}: scale ${s.scale.toFixed(3)} = fit ${expected.toFixed(3)}`);
    ok(Math.abs(s.w / s.h - 16 / 9) < 0.01, `${vp.w}×${vp.h}: rendered stage keeps 16:9 (${(s.w / s.h).toFixed(3)})`);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });

  console.log('No overflow / layout collisions:');
  for (let i = 0; i < SLIDES; i++) {
    await page.evaluate((idx) => window.Presentation.go(idx, { force: true }), i);
    await page.waitForTimeout(2100);
    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      innerW: window.innerWidth,
    }));
    ok(overflow.scrollW <= overflow.innerW + 2, `slide-${i + 1}: no horizontal overflow (${overflow.scrollW} vs ${overflow.innerW})`);
  }

  console.log('Full-screen & chrome:');
  await page.evaluate(() => window.Presentation.go(0, { force: true }));
  await page.click('#btn-fullscreen');
  await page.waitForTimeout(500);
  const fsOn = await page.evaluate(() => !!document.fullscreenElement);
  ok(fsOn, 'full-screen mode engages via button');
  if (fsOn) {
    await page.keyboard.press('F');
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => !document.fullscreenElement), 'F key exits full-screen');
  }
  await page.keyboard.press('h');
  ok(await page.evaluate(() => document.body.classList.contains('chrome-hidden')), 'H hides chrome');
  await page.keyboard.press('h');
  ok(await page.evaluate(() => !document.body.classList.contains('chrome-hidden')), 'H restores chrome');

  console.log('Deep link:');
  const page2 = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page2.goto(INDEX + '#slide-03', { waitUntil: 'load' });
  await page2.waitForTimeout(600);
  ok(await page2.evaluate(() => document.querySelector('.slide.active').id) === 'slide-03',
    'opening #slide-03 lands on slide 3');
  await page2.close();

  ok(errors.length === 0, `still no JS/console errors after full run (${errors.length || 'clean'})`);

  await browser.close();
  console.log(failures === 0 ? '\nPRESENTATION VERIFIED — all checks passed.' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
