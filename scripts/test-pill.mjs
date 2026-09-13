/**
 * E2E: плавающая «пилюля» нижней навигации (Liquid Glass, iOS 26).
 * Проверки: форма/позиция, линза движется между вкладками, активный цвет,
 * повторный тап «Каталог» (пульс+верх), kb-open, темы, десктоп скрыта,
 * регресс фикса полосы v3 (юбка/html-bg), консоль чистая.
 * Запуск: node scripts/test-pill.mjs (сервер на :3000)
 */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
let passed = 0;
let failed = 0;
const errors = [];

function ok(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    errors.push(name);
    console.log(`  ✗ FAIL: ${name} ${extra}`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

console.log("── 1. Пилюля: наличие, форма, позиция ──");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

const nav = page.locator("nav.pill-nav");
ok("nav.pill-nav видна", await nav.isVisible());
const shell = page.locator(".pill-shell");
ok(".pill-shell видна", await shell.isVisible());

const shellBox = await shell.boundingBox();
ok("пилюля не на всю ширину (max-width 440 + поля)", shellBox.width <= 440 + 1, `w=${shellBox.width}`);
ok("пилюля по центру", Math.abs(shellBox.x + shellBox.width / 2 - 195) < 3, `x=${shellBox.x}`);
ok("высота капсулы 64px", Math.abs(shellBox.height - 64) < 2, `h=${shellBox.height}`);

const shellStyle = await shell.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { radius: cs.borderRadius, pos: cs.position, blur: cs.backdropFilter || cs.webkitBackdropFilter };
});
ok("капсула fully-rounded (999px)", shellStyle.radius === "999px", shellStyle.radius);
ok("стекло с backdrop-blur", /blur/.test(shellStyle.blur), shellStyle.blur);

const navStyle = await nav.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { bottom: cs.bottom, pos: cs.position, pe: cs.pointerEvents };
});
ok("позиция fixed", navStyle.pos === "fixed");
ok("плавает над низом (bottom 10px)", Math.abs(parseFloat(navStyle.bottom) - 10) < 1.5, navStyle.bottom);
ok("обёртка не ловит клики мимо", navStyle.pe === "none");

console.log("── 2. Пункты и линза ──");
const items = page.locator(".pill-item");
ok("4 пункта", (await items.count()) === 4);
const labels = await items.allTextContents();
ok("подписи на месте", /Каталог/.test(labels[0]) && /Остатки/.test(labels[1]) && /Загрузка/.test(labels[2]) && /Админ/.test(labels[3]), labels.join("|"));

const lensCount = await page.locator(".nav-lens").count();
ok("линза одна (только у активного)", lensCount === 1);
const lensBox1 = await page.locator(".nav-lens").boundingBox();
const item1 = await items.nth(0).boundingBox();
ok("линза внутри активного пункта «Каталог»", Math.abs(lensBox1.x - item1.x) < 3 && Math.abs(lensBox1.width - item1.width) < 3, JSON.stringify(lensBox1));

const onColor = await items.nth(0).evaluate((el) => getComputedStyle(el).color);
ok("активный пункт в фирменном цвете", onColor === "rgb(15, 214, 207)", onColor); // --brand-strong #0fd6cf
const offColor = await items.nth(1).evaluate((el) => getComputedStyle(el).color);
ok("неактивный приглушён", offColor !== onColor, offColor);

console.log("── 3. Линза перетекает: тап «Остатки» ──");
await items.nth(1).click();
await page.waitForTimeout(650);
const lensBox2 = await page.locator(".nav-lens").boundingBox();
const item2 = await items.nth(1).boundingBox();
ok("линза переехала на «Остатки»", Math.abs(lensBox2.x - item2.x) < 3, `lens=${lensBox2.x} item=${item2.x}`);
ok("линза одна после перехода", (await page.locator(".nav-lens").count()) === 1);
const isOn2 = await items.nth(1).evaluate((el) => el.classList.contains("is-on"));
ok("класс is-on у «Остатки»", isOn2);
ok("заголовок в шапке «Остатки»", (await page.locator("header .font-display").textContent())?.trim() === "Остатки");

console.log("── 4. Тап «Загрузка» → линза едет дальше ──");
await items.nth(2).click();
await page.waitForTimeout(650);
const lensBox3 = await page.locator(".nav-lens").boundingBox();
const item3 = await items.nth(2).boundingBox();
ok("линза на «Загрузка»", Math.abs(lensBox3.x - item3.x) < 3);

console.log("── 5. Повторный тап «Каталог»: пульс + мгновенный верх (Шаг 2) ──");
await items.nth(0).click(); // сначала ПЕРЕХОД в каталог
await page.waitForTimeout(650);
await page.evaluate(() => window.scrollTo({ top: 999999, behavior: "instant" }));
await page.waitForTimeout(250);
const beforePulse = await page.evaluate(() => window.scrollY);
ok("страница проскроллена", beforePulse > 50, `got ${beforePulse}`);
await items.nth(0).click(); // теперь ПОВТОРНЫЙ тап → сброс наверх + пульс
await page.waitForTimeout(120);
const pulsing = await page.evaluate(() => {
  const b = document.querySelectorAll(".pill-item")[0];
  return b.classList.contains("nav-pulse");
});
ok("пульс-класс nav-pulse активирован", pulsing);
await page.waitForTimeout(600);
const scrollY2 = await page.evaluate(() => window.scrollY);
ok("scrollY = 0 после повторного тапа", scrollY2 === 0, `got ${scrollY2}`);
const lensBack = await page.locator(".nav-lens").boundingBox();
ok("линза вернулась на «Каталог»", Math.abs(lensBack.x - item1.x) < 3);

console.log("── 6. Клавиатура (kb-open) — пилюля уезжает ──");
await page.evaluate(() => document.documentElement.classList.add("kb-open"));
await page.waitForTimeout(450);
const kbT = await nav.evaluate((el) => getComputedStyle(el).transform);
ok("kb-open: пилюля спрятана (translateY)", kbT.includes("matrix") && kbT !== "none", kbT);
await page.evaluate(() => document.documentElement.classList.remove("kb-open"));
await page.waitForTimeout(450);

console.log("── 7. Светлая тема ──");
await page.evaluate(() => {
  document.documentElement.classList.add("light");
  document.documentElement.classList.remove("dark");
});
await page.waitForTimeout(250);
const lightBg = await shell.evaluate((el) => getComputedStyle(el).backgroundColor);
ok("светлая тема: стекло светлое", /^rgba\(255,\s*255,\s*255/.test(lightBg), lightBg);
const lightLens = await page.locator(".nav-lens").evaluate((el) => getComputedStyle(el).boxShadow);
ok("светлая линза с белой кромкой", /255,\s*255,\s*255/.test(lightLens));
await page.screenshot({ path: "tool-results/pill-light.png" });
await page.evaluate(() => {
  document.documentElement.classList.add("dark");
  document.documentElement.classList.remove("light");
});
await page.waitForTimeout(250);

console.log("── 8. Скриншоты (каталог/остатки) + регресс юбки v3 ──");
await page.screenshot({ path: "tool-results/pill-dark-catalog.png" });
const skirt = await page.locator(".fx-skirt").count();
ok("фикс v3: юбка на месте", skirt === 1);
const htmlBg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
ok("фикс v3: html фон --edge (#10161a)", htmlBg === "rgb(16, 22, 26)", htmlBg);
await items.nth(1).click();
await page.waitForTimeout(600);
await page.screenshot({ path: "tool-results/pill-dark-stock.png" });

console.log("── 9. Товар открыт — пилюля остаётся ──");
await items.nth(0).click();
await page.waitForTimeout(500);
const firstCard = page.locator("main button").filter({ hasNot: page.locator("nav") }).first();
await page.locator('button:has-text("Все ткани")').first().click().catch(() => {});
await page.waitForTimeout(500);
// открываем первый товар из сетки
const cardBtn = page.locator("main .spot, main button").filter({ has: page.locator("img") }).first();
if (await cardBtn.count()) {
  await cardBtn.click({ trial: true }).catch(() => {});
  await cardBtn.click().catch(() => {});
  await page.waitForTimeout(700);
}
ok("пилюля видна и на товаре/глубине", await nav.isVisible());

console.log("── 10. Десктоп: пилюля скрыта, сайдбар на месте ──");
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(400);
ok("пилюля скрыта на lg", !(await nav.isVisible()));
ok("сайдбар виден", await page.locator("aside").isVisible());

console.log("── 11. Консоль ──");
const realErrors = consoleErrors.filter((e) => !/Download the React DevTools/i.test(e));
ok("консоль чистая", realErrors.length === 0, JSON.stringify(realErrors).slice(0, 300));

console.log(`\n═══ ИТОГ: ${passed} ✓ / ${failed} ✗ ═══`);
if (failed) {
  console.log("Провалены:", errors.join(" | "));
  process.exit(1);
}
await browser.close();
