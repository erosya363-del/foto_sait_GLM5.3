/** Скриншоты v1.7 Liquid Glass: мобильный каталог/админка/светлая + десктоп-админ */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const OUT = "download/screenshots";
const browser = await chromium.launch();

async function shot(name, fn, vp = { width: 390, height: 800 }) {
  const page = await browser.newPage({ viewport: vp });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await fn(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("✓", name);
  await page.close();
}

// 1. Мобильный: каталог → категория (шапка + капсула-поиск + «Назад»)
await shot("v16-mob-catalog-level2", async (p) => {
  await p.evaluate(() => document.querySelectorAll(".chip")[1]?.closest("button") === null
    ? null
    : null);
  // первый уровень каталога: клик по первой категории-карточке
  const cat = p.locator("main button, main a").filter({ hasText: /Диваны|Кровати|Матрасы/ }).first();
  if (await cat.count()) await cat.click();
  await p.waitForTimeout(900);
});

// 2. Мобильный: админка — товары (lg-seg + lg-row + Тест вибрации)
await shot("v16-mob-admin-products", async (p) => {
  await p.locator(".pill-item", { hasText: "Админ" }).click();
  await p.waitForTimeout(1100);
});

// 3. Мобильный: админка — справочники (lg-seg переключатель)
await shot("v16-mob-admin-dicts", async (p) => {
  await p.locator(".pill-item", { hasText: "Админ" }).click();
  await p.waitForTimeout(900);
  await p.locator('[role="tablist"] button, button[role="tab"]').filter({ hasText: "Справочники" }).first().click();
  await p.waitForTimeout(800);
});

// 4. Мобильная светлая тема: каталог
await shot("v16-mob-light-catalog", async (p) => {
  await p.evaluate(() => {
    document.documentElement.classList.add("light");
    document.documentElement.classList.remove("dark");
  });
  await p.waitForTimeout(600);
});

// 5. Десктоп: админка-товары (сайдбар + lg-seg)
await shot("v16-desktop-admin", async (p) => {
  await p.locator(".side-link", { hasText: "Админ" }).click();
  await p.waitForTimeout(1100);
}, { width: 1440, height: 900 });

// 6. Мобильный: подвесной поиск-стекло (капсула + дропдаун).
//    Скроллим ВНУТРИ категории — на L1 после чистки мусора страница короткая.
await shot("v16-mob-search-pop", async (p) => {
  const row = p.locator("main button, main a").filter({ hasText: /Все ткани/ }).first();
  if (await row.count()) await row.click();
  await p.waitForTimeout(900);
  await p.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
  await p.waitForTimeout(600);
  await p.locator(".search-fab").click();
  await p.waitForTimeout(700);
  await p.fill("#global-search", "магни");
  await p.waitForTimeout(900);
});

await browser.close();
console.log("Готово");
