// Отладка дриллдауна: что на экране после каждого шага
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
page.on('console', (m) => console.log('[console:' + m.type() + ']', m.text().slice(0, 200)));
page.on('response', (r) => { if (r.status() >= 500) console.log('[500]', r.url()); });
await page.goto(BASE + '/', { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(2000);
console.log('URL:', page.url());

// структура навигации
const nav = await page.evaluate(() => {
  const items = [...document.querySelectorAll('button, a')].slice(0, 60).map(b => (b.textContent || '').trim().slice(0, 30)).filter(Boolean);
  return items;
});
console.log('BUTTONS:', JSON.stringify(nav));

// пилюля?
const pill = await page.evaluate(() => {
  const shell = document.querySelector('.pill-shell');
  if (!shell) return null;
  return [...shell.querySelectorAll('.pill-item, button')].map(b => (b.textContent || '').trim());
});
console.log('PILL:', JSON.stringify(pill));
await page.screenshot({ path: '/home/z/my-project/tool-results/v27-start.png' });
await browser.close();
