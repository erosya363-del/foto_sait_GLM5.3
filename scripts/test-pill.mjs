/**
 * E2E: плавающая «пилюля» Liquid Glass v2 + умная шапка + подвесной поиск.
 * Проверки: 5 пунктов, линза пружиной (stiffness 430), жидкий сквош+SVG-фильтр,
 * pill-dim при скролле / pill-active при касании, 5-й пункт «Поиск» фокусирует
 * поле, шапка сворачивается при скролле, кружок → подвесной поиск → сворачивание
 * при листании, темы, регресс юбки v3, десктоп, консоль чистая.
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

/** Дождаться завершения CSS-перехода (флаки под нагрузкой, как в test-s6):
    опрашиваем значение до 2.5с, пока не выполнится предикат. */
async function settle(poll, pred, timeout = 2500) {
  const t0 = Date.now();
  let v = await poll();
  while (!pred(v) && Date.now() - t0 < timeout) {
    await page.waitForTimeout(120);
    v = await poll();
  }
  return v;
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
ok("пилюля не на всю ширину (max-width 460 + поля)", shellBox.width <= 460 + 1, `w=${shellBox.width}`);
ok("пилюля по центру", Math.abs(shellBox.x + shellBox.width / 2 - 195) < 3, `x=${shellBox.x}`);
ok("высота капсулы 64px", Math.abs(shellBox.height - 64) < 2, `h=${shellBox.height}`);

const shellStyle = await shell.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { radius: cs.borderRadius, pos: cs.position, blur: cs.backdropFilter || cs.webkitBackdropFilter, bg: cs.backgroundColor };
});
ok("капсула fully-rounded (999px)", shellStyle.radius === "999px", shellStyle.radius);
ok("стекло blur 30px", /30px/.test(shellStyle.blur), shellStyle.blur);

const navStyle = await nav.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { bottom: cs.bottom, pos: cs.position, pe: cs.pointerEvents };
});
ok("позиция fixed", navStyle.pos === "fixed");
ok("плавает над низом (bottom 10px)", Math.abs(parseFloat(navStyle.bottom) - 10) < 1.5, navStyle.bottom);
ok("обёртка не ловит клики мимо", navStyle.pe === "none");

console.log("── 2. Пункты (4, без «Поиск») и линза ──");
const items = page.locator(".pill-item");
ok("4 пункта (пятый «Поиск» убран по просьбе)", (await items.count()) === 4);
const labels = await items.allTextContents();
ok("подписи на месте, без «Поиск»", /Каталог/.test(labels[0]) && /Остатки/.test(labels[1]) && /Загрузка/.test(labels[2]) && /Админ/.test(labels[3]) && labels.every((l) => !/Поиск/.test(l)), labels.join("|"));

ok("SVG-фильтр #nav-liquid в DOM", (await page.locator("#nav-liquid").count()) === 1);
const lensCount = await page.locator(".nav-lens").count();
ok("линза одна (только у активного)", lensCount === 1);
const lensBox1 = await page.locator(".nav-lens").boundingBox();
const item1 = await items.nth(0).boundingBox();
ok("линза внутри активного пункта «Каталог»", Math.abs(lensBox1.x - item1.x) < 3 && Math.abs(lensBox1.width - item1.width) < 3, JSON.stringify(lensBox1));
ok("линза имеет ядро .nav-lens-core", (await page.locator(".nav-lens .nav-lens-core").count()) === 1);

const onColor = await items.nth(0).evaluate((el) => getComputedStyle(el).color);
ok("активный пункт в фирменном цвете", onColor === "rgb(15, 214, 207)", onColor);

console.log("── 3. Жидкий переезд линзы: сквош + spring 430 ──");
await items.nth(1).click();
await page.waitForTimeout(120); // эффект ставит классы сразу после рендера
// сразу — класс is-squash на линзе и is-liquid на капсуле (Chromium)
const liquidNow = await page.evaluate(() => {
  const lens = document.querySelector(".nav-lens");
  const sh = document.querySelector(".pill-shell");
  return { squash: lens?.classList.contains("is-squash") ?? false, liquid: sh?.classList.contains("is-liquid") ?? false };
});
ok("сквош-класс is-squash активен сразу после тапа", liquidNow.squash);
ok("is-liquid на капсуле (Chromium)", liquidNow.liquid);
const filterNow = await shell.evaluate((el) => getComputedStyle(el).filter);
ok("капсула с filter:url(#nav-liquid) в полёте", /nav-liquid/.test(filterNow), filterNow);
await page.waitForTimeout(700);
const liquidAfter = await page.evaluate(() => {
  const lens = document.querySelector(".nav-lens");
  const sh = document.querySelector(".pill-shell");
  return { squash: lens?.classList.contains("is-squash") ?? false, liquid: sh?.classList.contains("is-liquid") ?? false };
});
ok("сквош снят через ~700мс", !liquidAfter.squash && !liquidAfter.liquid);
const lensBox2 = await page.locator(".nav-lens").boundingBox();
const item2 = await items.nth(1).boundingBox();
ok("линза приземлилась на «Остатки»", Math.abs(lensBox2.x - item2.x) < 3, `lens=${lensBox2.x} item=${item2.x}`);
ok("заголовок в шапке «Askona Остатки»", (await page.locator("header .font-display").textContent())?.trim() === "Askona Остатки");

console.log("── 4. Тап «Загрузка» → линза едет дальше ──");
await items.nth(2).click();
await page.waitForTimeout(650);
const lensBox3 = await page.locator(".nav-lens").boundingBox();
const item3 = await items.nth(2).boundingBox();
ok("линза на «Загрузка»", Math.abs(lensBox3.x - item3.x) < 3);

console.log("── 5. Пилюля и скролл/касание: pill-dim / pill-active ──");
// скроллим «Остатки» (на L1 каталога места под скролл почти нет)
await page.locator('nav.pill-nav button:has-text("Остатки")').click();
await page.waitForTimeout(600);
ok("наверху: нет pill-dim", !(await shell.evaluate((el) => el.classList.contains("pill-dim"))));
// безопасный «тап мимо» (не по контенту — чтобы не открыть товар): синтетический pointerdown
const tapElsewhere = () => page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerdown")));
await tapElsewhere();
await page.waitForTimeout(300);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(350);
await page.evaluate(() => window.scrollTo({ top: 300, behavior: "instant" }));
await page.waitForTimeout(400);
ok("после скролла: pill-dim", await shell.evaluate((el) => el.classList.contains("pill-dim")));
const bgDim = await shell.evaluate((el) => getComputedStyle(el).backgroundColor);
ok("фон прозрачнее при скролле", bgDim !== shellStyle.bg, `${shellStyle.bg} → ${bgDim}`);
ok("неактивные пункты при скролле растворяются (0.38)", Math.abs(Number(await items.nth(0).evaluate((el) => getComputedStyle(el).opacity)) - 0.38) < 0.03);
ok("активный пункт горит (0.8)", Math.abs(Number(await items.nth(1).evaluate((el) => getComputedStyle(el).opacity)) - 0.8) < 0.03);
// касание пилюли → pill-active; касание мимо → снялось (синтетический pointerdown — без активации пункта)
await page.evaluate(() => {
  document.querySelector(".pill-shell")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 99 }));
});
await page.waitForTimeout(250);
ok("тап по пилюле → pill-active", await shell.evaluate((el) => el.classList.contains("pill-active")));
const bgActive = await shell.evaluate((el) => getComputedStyle(el).backgroundColor);
ok("активный фон плотнее", bgActive !== bgDim, `${bgDim} → ${bgActive}`);
await tapElsewhere();
await page.waitForTimeout(250);
ok("тап мимо → pill-active снялся", !(await shell.evaluate((el) => el.classList.contains("pill-active"))));

console.log("── 6. Шапка: сворачивание при скролле ──");
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(400);
const logo = page.locator("header img[alt='Askona']");
const searchPanel = page.locator(".search-collapse");
ok("на мобиле: лого скрыт (заголовок «Askona …» вместо него)", !(await logo.isVisible()));
ok("наверху: панель поиска видна", await searchPanel.isVisible());
ok("наверху: заголовок раздела виден", await page.locator("header .font-display").isVisible());
const fab0 = page.locator(".search-fab");
ok("наверху: кружка нет", (await fab0.count()) === 0);
await page.evaluate(() => window.scrollTo({ top: 300, behavior: "instant" }));
await page.waitForTimeout(500);
const titleOpacity = await settle(
  () => page.locator("header .font-display").evaluate((el) => Number(getComputedStyle(el.closest(".header-fade") ?? el).opacity)),
  (v) => v < 0.05
);
ok("при скролле: заголовок скрыт (opacity 0)", titleOpacity < 0.05, `opacity=${titleOpacity}`);
const hdrBg = await settle(
  () => page.locator("header.glass").evaluate((el) => getComputedStyle(el).backgroundColor),
  (v) => v === "rgba(0, 0, 0, 0)"
);
ok("при скролле: шапка полностью прозрачна", hdrBg === "rgba(0, 0, 0, 0)", hdrBg);
const panelH = await settle(
  async () => (await searchPanel.boundingBox())?.height ?? 0,
  (v) => v <= 2
);
ok("при скролле: панель поиска свернулась (высота ≤2px)", panelH <= 2, `h=${panelH}`);
ok("при скролле: кружок поиска появился", await fab0.isVisible());
ok("при скролле: «Назад» осталась (шапка жива)", await page.locator("header").isVisible());

console.log("── 7. Кружок → подвесной поиск → листание сжимает ──");
await fab0.click();
await page.waitForTimeout(450);
const pop = page.locator(".search-pop");
ok("подвесной поиск открылся", await pop.isVisible());
const panelH2 = (await searchPanel.boundingBox())?.height ?? 0;
ok("панельный поиск при этом свернут", panelH2 <= 2, `h=${panelH2}`);
const focused1 = await page.evaluate(() => document.activeElement?.id);
ok("поле поиска в фокусе (клавиатура)", focused1 === "global-search", `activeElement=${focused1}`);
// печатаем — дропдаун в подвесном формате
await page.keyboard.type("диван");
await page.waitForTimeout(600);
ok("дропдаун подсказок открыт", await page.locator(".search-pop .absolute").first().isVisible().catch(() => false));
// листание (в любую сторону >30px; вниз места нет — L1 max 108) — подвесной закрылся
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(500);
ok("листание закрыло подвесной поиск", (await page.locator(".search-pop").count()) === 0);
// вернулись вниз — кружок снова на месте
await page.evaluate(() => window.scrollTo({ top: 108, behavior: "instant" }));
await page.waitForTimeout(500);
ok("кружок вернулся", await fab0.isVisible());

console.log("── 8. Повторный тап «Каталог»: пульс + мгновенный верх (Шаг 2) ──");
await items.nth(0).click(); // из остатков → в каталог (обычный переход, без пульса)
await page.waitForTimeout(600);
// запас скролла: открываем «Все ткани» (длинная сетка)
await page.evaluate(() => window.__portal.setState({ catFabrics: true }));
await page.waitForTimeout(900);
await page.evaluate(() => window.scrollTo({ top: 999999, behavior: "instant" }));
await page.waitForTimeout(250);
const beforePulse = await page.evaluate(() => window.scrollY);
ok("страница проскроллена", beforePulse > 50, `got ${beforePulse}`);
await items.nth(0).click();
await page.waitForTimeout(120);
const pulsing = await page.evaluate(() => document.querySelectorAll(".pill-item")[0].classList.contains("nav-pulse"));
ok("пульс-класс nav-pulse активирован", pulsing);
await page.waitForTimeout(600);
const scrollY2 = await page.evaluate(() => window.scrollY);
ok("scrollY = 0 после повторного тапа", scrollY2 === 0, `got ${scrollY2}`);
ok("линза вернулась на «Каталог»", await items.nth(0).evaluate((el) => el.classList.contains("is-on")));

console.log("── 10. Светлая тема ──");
await page.evaluate(() => {
  document.documentElement.classList.add("light");
  document.documentElement.classList.remove("dark");
});
await page.waitForTimeout(600); // 280мс переход фона темы должен завершиться
const lightBg = await settle(
  () => shell.evaluate((el) => getComputedStyle(el).backgroundColor),
  (v) => /^rgba\(255,\s*255,\s*255/.test(v)
);
ok("светлая тема: стекло светлое", /^rgba\(255,\s*255,\s*255/.test(lightBg), lightBg);
const lightLens = await page.locator(".nav-lens-core").evaluate((el) => getComputedStyle(el).boxShadow);
ok("светлая линза с белой кромкой", /255,\s*255,\s*255/.test(lightLens));
await page.screenshot({ path: "tool-results/pill-light.png" });
await page.evaluate(() => {
  document.documentElement.classList.add("dark");
  document.documentElement.classList.remove("light");
});
await page.waitForTimeout(250);

console.log("── 11. Скриншоты + регресс юбки v3 ──");
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(400);
await page.screenshot({ path: "tool-results/pill-dark-catalog.png" });
await page.evaluate(() => window.scrollTo({ top: 300, behavior: "instant" }));
await page.waitForTimeout(500);
await page.screenshot({ path: "tool-results/pill-dark-scrolled.png" });
const skirt = await page.locator(".fx-skirt").count();
ok("фикс v3: юбка на месте", skirt === 1);
const htmlBg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
ok("фикс v3: html фон --edge (#10161a)", htmlBg === "rgb(16, 22, 26)", htmlBg);

console.log("── 12. Десктоп: пилюля и кружок скрыты, шапка не сворачивается ──");
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(400);
ok("пилюля скрыта на lg", !(await nav.isVisible()));
ok("сайдбар виден", await page.locator("aside").isVisible());
await page.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
await page.waitForTimeout(400);
ok("десктоп: лого виден при скролле (шапка не сворачивается)", await logo.isVisible());
ok("десктоп: панель поиска видна", await searchPanel.isVisible());

console.log("── 13. Консоль ──");
const realErrors = consoleErrors.filter((e) => !/Download the React DevTools/i.test(e));
ok("консоль чистая", realErrors.length === 0, JSON.stringify(realErrors).slice(0, 300));

console.log(`\n═══ ИТОГ: ${passed} ✓ / ${failed} ✗ ═══`);
if (failed) {
  console.log("Провалены:", errors.join(" | "));
  process.exit(1);
}
await browser.close();
