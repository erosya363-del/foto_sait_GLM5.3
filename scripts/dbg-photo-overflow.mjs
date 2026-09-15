// АУДИТ v2.7: источник переполнения фото + метрики загрузки
import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';
const iPhone = {
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 3,
  isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
};
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...iPhone });
const page = await ctx.newPage();
const t0 = Date.now();
await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {});
console.log('start load ms:', Date.now() - t0);
await page.waitForTimeout(1500);

// дриллдаун до товара
await page.locator('button:has-text("Диваны"):visible').first().click();
await page.waitForTimeout(1200);
await page.locator('button:has-text("вариантов фото"):visible').first().click();
await page.waitForTimeout(1200);
await page.locator('button.card-hover:visible').first().click();
await page.waitForTimeout(2200);

const m = await page.evaluate(() => {
  const img = document.querySelector('.photo-frame img');
  const fig = document.querySelector('.photo-frame');
  const col = fig?.parentElement;
  const grid = col?.parentElement;
  const ir = img ? img.getBoundingClientRect() : null;
  const info = img ? {
    natural: { w: img.naturalWidth, h: img.naturalHeight },
    rendered: { w: +ir.width.toFixed(1), h: +ir.height.toFixed(1) },
    src: img.currentSrc.split('/').pop(),
  } : null;
  return {
    viewport: { iw: innerWidth, sw: document.documentElement.scrollWidth, overflowX: document.documentElement.scrollWidth > innerWidth },
    img: info,
    fig: fig ? { w: +fig.getBoundingClientRect().width.toFixed(1) } : null,
    col: col ? { cls: col.className.slice(0, 60), w: +col.getBoundingClientRect().width.toFixed(1) } : null,
    grid: grid ? { cls: grid.className.slice(0, 60), w: +grid.getBoundingClientRect().width.toFixed(1) } : null,
    main: (() => { const mn = document.querySelector('main'); return mn ? { w: +mn.getBoundingClientRect().width.toFixed(1) } : null; })(),
    // все элементы, вылезающие за правый край
    offenders: (() => {
      const out = [];
      document.querySelectorAll('main *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > innerWidth + 1 && !el.querySelector('.photo-frame') && !el.closest('.photo-frame'))
          if (out.length < 6) out.push({ tag: el.tagName, cls: String(el.className).slice(0, 50), right: +r.right.toFixed(1), w: +r.width.toFixed(1) });
      });
      return out;
    })(),
  };
});
console.log(JSON.stringify(m, null, 1));

// ── метрики веса страницы товара ──
const perf = await page.evaluate(() => {
  const res = performance.getEntriesByType('resource');
  const imgs = res.filter(r => r.initiatorType === 'img' || r.name.match(/\.(jpg|jpeg|png|webp|avif)/i));
  const totalImgBytes = imgs.reduce((a, r) => a + (r.transferSize || 0), 0);
  const totalAll = res.reduce((a, r) => a + (r.transferSize || 0), 0);
  const biggest = imgs.map(r => ({ n: r.name.split('/').pop().slice(0, 40), kb: Math.round((r.transferSize || 0) / 1024), ms: Math.round(r.duration) }))
    .sort((a, b) => b.kb - a.kb).slice(0, 8);
  return { resources: res.length, totalKB: Math.round(totalAll / 1024), imgKB: Math.round(totalImgBytes / 1024), biggest };
});
console.log('PERF:', JSON.stringify(perf, null, 1));
await browser.close();
