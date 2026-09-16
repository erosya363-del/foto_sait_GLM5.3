// АУДИТ v2.7: дриллдаун каталог → модель → вариант → лента фото + геометрия
import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';
const OUT = '/home/z/my-project/tool-results';
const iPhone = {
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 3,
  isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
};
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...iPhone });
const page = await ctx.newPage();
page.on('response', (r) => { if (r.status() >= 500) console.log('[500]', r.url()); });

await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(1800);

// шаг 1: категория (видимая карточка с текстом «Диваны»)
await page.locator('button:has-text("Диваны"):visible').first().click();
await page.waitForTimeout(1400);
console.log('step1 (категория) ok, url=', page.url());

// шаг 2: первая модель («N вариантов фото»)
const modelBtn = page.locator('button:has-text("вариантов фото"):visible').first();
if (await modelBtn.count()) { await modelBtn.click(); await page.waitForTimeout(1400); }
console.log('step2 (модель) ok');

// шаг 3: первая карточка варианта → товар
const variantBtn = page.locator('.card-hover:visible button, button.card-hover:visible').first();
const alt = page.locator('main button:visible:has(img)').first();
if (await variantBtn.count()) { await variantBtn.click(); } else if (await alt.count()) { await alt.click(); }
await page.waitForTimeout(2000);
console.log('step3 (вариант) ok');

const frames = await page.evaluate(() => document.querySelectorAll('.photo-frame, figure[role="button"]').length);
console.log('photo-frames on page:', frames);

if (frames > 0) {
  await page.screenshot({ path: OUT + '/v27-product-top.png' });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1400);
  await page.screenshot({ path: OUT + '/v27-product-bottom.png' });

  const geo = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.photo-frame').forEach((f, i) => {
      if (i > 2) return;
      const fr = f.getBoundingClientRect();
      const img = f.querySelector('img');
      const ics = img ? getComputedStyle(img) : null;
      const fcs = getComputedStyle(f);
      out.push({
        frame: { radius: fcs.borderRadius, overflow: fcs.overflow, w: +fr.width.toFixed(1) },
        img: ics ? { transform: ics.transform, willChange: ics.willChange, draggable: img.draggable } : null,
      });
    });
    // нет ли на странице выбросов img за рамку (клиппинг сломан)
    const leaks = [];
    document.querySelectorAll('.photo-frame img').forEach((img, i) => {
      if (i > 8) return;
      const ir = img.getBoundingClientRect();
      const fr = img.closest('.photo-frame').getBoundingClientRect();
      if (ir.left < fr.left - 0.6 || ir.right > fr.right + 0.6 || ir.top < fr.top - 0.6 || ir.bottom > fr.bottom + 0.6)
        leaks.push({ i, img: { l: +ir.left.toFixed(1), r: +ir.right.toFixed(1), t: +ir.top.toFixed(1), b: +ir.bottom.toFixed(1) }, frame: { l: +fr.left.toFixed(1), r: +fr.right.toFixed(1), t: +fr.top.toFixed(1), b: +fr.bottom.toFixed(1) } });
    });
    return { geo: out, leaks };
  });
  console.log('PHOTO GEO:', JSON.stringify(geo, null, 1));
}

await ctx.close();

// ── Остатки через пилюлю ──
{
  const ctx2 = await browser.newContext({ ...iPhone });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {});
  await p2.waitForTimeout(1500);
  const pillBtn = p2.locator('.pill-shell button:has-text("Остатки"), .pill-shell .pill-item:has-text("Остатки")').first();
  await pillBtn.click({ timeout: 8000 }).catch(async (e) => {
    console.log('pill click fail:', String(e).slice(0, 120));
    await p2.evaluate(() => { const b = [...document.querySelectorAll('.pill-shell button')].find(x => x.textContent.includes('Остатки')); b && b.click(); });
  });
  await p2.waitForTimeout(1600);
  const n = await p2.evaluate(() => document.querySelectorAll('.card-hover').length);
  console.log('STOCK cards:', n);
  await p2.screenshot({ path: OUT + '/v27-stock.png' });
  await ctx2.close();
}

await browser.close();
console.log('DONE');
