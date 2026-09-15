import { chromium } from "playwright";

/* Диагностика v2.6: холодный старт (полоса), панель, поиск, карточка ткани */
const BASE = "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 760 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
await ctx.addInitScript(() => {
  try { localStorage.clear(); sessionStorage.clear(); } catch {}
});
const page = await ctx.newPage();

// ХОЛОДНЫЙ СТАРТ: скрин как можно раньше (до nudge-скриптов)
await page.goto(BASE, { waitUntil: "commit" });
await page.waitForTimeout(350);
await page.screenshot({ path: "tool-results/v26-cold-350ms.png" });
await page.waitForTimeout(600);
await page.screenshot({ path: "tool-results/v26-cold-950ms.png" });
await page.waitForTimeout(2500);
await page.screenshot({ path: "tool-results/v26-cold-settled.png" });

// Геометрия панели/юбки
const geo = await page.evaluate(() => {
  const pill = document.querySelector(".pill-shell")?.getBoundingClientRect();
  const skirt = document.querySelector(".fx-skirt")?.getBoundingClientRect();
  const amb = document.querySelector(".ambient")?.getBoundingClientRect();
  const search = document.querySelector(".pill-search")?.getBoundingClientRect();
  const sep = document.querySelector(".pill-sep")?.getBoundingClientRect();
  const items = [...document.querySelectorAll(".pill-item")].map((el) => el.getBoundingClientRect().width);
  return {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    pill: pill && { x: pill.x, w: pill.width, h: pill.height, bottom: innerHeight - pill.bottom },
    skirt: skirt && { x: skirt.x, w: skirt.width, bottom: innerHeight - skirt.bottom },
    ambient: amb && { w: amb.width, h: amb.height },
    search: search && { x: search.x, w: search.width, h: search.height },
    sep: sep && { w: sep.width },
    itemWidths: items,
    themeColorMeta: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.outerHTML),
    htmlClass: document.documentElement.className,
  };
});
console.log(JSON.stringify(geo, null, 2));

// Светлая тема (как у владельца на скриншоте)
await page.evaluate(() => {
  document.documentElement.classList.add("light");
  document.documentElement.classList.remove("dark");
});
await page.waitForTimeout(700);
await page.screenshot({ path: "tool-results/v26-light-start.png" });

// Драг по панели: линза должна следовать, не растягиваться; проверка цвета кромки
const shell = await page.locator(".pill-shell").boundingBox();
if (shell) {
  await page.touchscreen.tap(shell.x + shell.width / 2, shell.y + shell.height / 2).catch(() => {});
}
await page.waitForTimeout(400);
await page.screenshot({ path: "tool-results/v26-light-pill-touch.png" });

// Поиск: последние запросы (без «Популярного»)
await page.evaluate(() => document.querySelector(".pill-search")?.click());
await page.waitForTimeout(600);
await page.screenshot({ path: "tool-results/v26-search-empty.png" });

// Применить запрос, переоткрыть — появился блок «последние»
await page.keyboard.type("лофт");
await page.waitForTimeout(700);
await page.keyboard.press("Enter");
await page.waitForTimeout(900);
await page.evaluate(() => document.querySelector(".pill-search")?.click());
await page.waitForTimeout(500);
await page.screenshot({ path: "tool-results/v26-search-recent.png" });

// Дриллдаун: Все ткани → первая ткань → первый товар (большая карточка?)
await page.evaluate(() => window.__portal?.getState()?.resetCatalog());
await page.waitForTimeout(300);
await page.evaluate(() => window.__portal?.getState()?.setCatFabrics(true));
await page.waitForTimeout(900);
await page.screenshot({ path: "tool-results/v26-fabrics.png" });
const fabricBtn = page.locator("button", { hasText: /sky/i }).first();
if (await fabricBtn.count()) {
  await fabricBtn.click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "tool-results/v26-fabric-variants.png" });
  await page.locator("main button img").first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "tool-results/v26-product.png" });
  // сколько кнопок «Назад» на экране?
  const backs = await page.evaluate(() => document.querySelectorAll('button[aria-label="Назад"]').length);
  console.log("BACK_BUTTONS_ON_PRODUCT:", backs);
}

await browser.close();
console.log("OK: v26 диагностика сохранена в tool-results/");
