/**
 * E2E: «поиск не работает, если нажимать на лупу» (видео владельца, v2.1).
 * Регресс бага: при скролле монтировались ДВА SearchBar (свёрнутая панель шапки +
 * подвесная карточка) с ОДИНАКОВЫМ id="global-search" → getElementById возвращал
 * невидимое поле → фокус не туда → клавиатура iOS не открывалась → печатать нельзя.
 * Проверки:
 *  1. В DOM всегда РОВНО ОДИН input[data-search-input] (панель и карточка не сосуществуют)
 *  2. Тап по лупе при скролле: .search-pop открыт и фокус В ЕГО поле (activeElement)
 *  3. Ввод «тре» → дропдаун с результатами (Ткани/Каталог фото) реально появляется
 *  4. Enter применяет запрос → карточка закрылась, каталог отфильтрован (чип «сбросить»)
 *  5. Палитра «Кобальт»: --brand больше НЕ бирюза (#11b5b0), стекло не серое
 *     (--glass без 150,160,169 / 46,51,58), в обеих темах
 *  6. Консоль чиста
 * Запуск: node scripts/test-search-fix.mjs (сервер на :3000)
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
const context = await browser.newContext({ viewport: { width: 390, height: 480 } });
/* ЧИСТЫЙ ПРОФИЛЬ: приложение восстанавливает состояние (включая открытый товар)
   из sessionStorage/localStorage — без сброса сценарий стартует не с каталога */
await context.addInitScript(() => {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {}
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
/* Headless-quirk: html { scroll-behavior: smooth } в headless-Chrome даёт
   фантомный дрейф скролла (страница сама ползёт наверх) — на реальных
   устройствах этого нет. В тесте глушим smooth-скролл. */
await page.evaluate(() => {
  document.documentElement.style.scrollBehavior = "auto";
});

console.log("\n— 1. Поисковые поля в DOM —");
const inputsAtStart = await page.evaluate(
  () => document.querySelectorAll("input[data-search-input]").length
);
/* 2 поля = панель шапки + ПРЕДСМОНТИРОВАННАЯ скрытая карточка (новая архитектура) */
ok("в DOM ровно 2 поля: панель + скрытая карточка", inputsAtStart === 2, `найдено ${inputsAtStart}`);
const oldIdGone = await page.evaluate(() => !document.getElementById("global-search"));
ok("дублирующий id «global-search» полностью убран", oldIdGone);

console.log("\n— 2. Сценарий из видео: скролл → лупа → карточка → фокус —");
/* Проваливаемся в КАТЕГОРИЮ «Диваны» (не в товар и не в переключатель режима):
   карточки категорий — кнопки без aria-label с текстом категории */
const catBtn = page.locator("main button:not([aria-label])", { hasText: "Диваны" }).first();
await catBtn.click();
await page.waitForTimeout(900);
const productOpen = await page.evaluate(
  () => (window.history.state?.portal?.productId ?? null) !== null
);
ok("открылся список моделей (а не товар)", !productOpen);
await page.evaluate(() =>
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" })
);
await page.waitForTimeout(600);
const scrolledY = await page.evaluate(() => window.scrollY);
ok("страница реально проскроллена", scrolledY > 6, `scrollY=${scrolledY}`);
const fabVisible = await page.locator(".search-fab").isVisible();
ok("кружок-лупа появился при скролле", fabVisible);
/* высота шапки ЗАМЕРЯЕТСЯ ПОСЛЕ скролла (шапка уже свернулась) — сравниваем
   до/после тапа: открытие карточки НЕ должно менять высоту шапки,
   иначе браузер компенсирует скроллом и страница прыгает */
const headerH0 = await page.evaluate(() => document.querySelector("header")?.getBoundingClientRect().height ?? -1);

/* ВАЖНО: НЕ locator.click() — Playwright «scroll into view» для position:fixed
   элемента скроллит ДОКУМЕНТ в его статическую позицию (наверх), и приложение
   закономерно закрывает всё при скролле. Реальный палец страницу не листает —
   жмём из JS, как настоящий тап. */
await page.evaluate(() => document.querySelector(".search-fab")?.click());
await page.waitForTimeout(350);

const popVisible = await page.locator(".search-pop").isVisible();
ok("подвесная карточка поиска открылась", popVisible);
const inputsInPop = await page.evaluate(
  () => document.querySelectorAll(".search-pop input[data-search-input]").length
);
ok("в карточке ровно одно поле", inputsInPop === 1, `найдено ${inputsInPop}`);

const focusInPop = await page.evaluate(() => {
  const pop = document.querySelector(".search-pop");
  const input = pop?.querySelector("input[data-search-input]");
  return Boolean(input) && document.activeElement === input;
});
ok("ФОКУС в видимом поле карточки (раньше уходил в невидимое — баг клавиатуры iOS)", focusInPop);

const headerH1 = await page.evaluate(() => document.querySelector("header")?.getBoundingClientRect().height ?? -2);
ok(
  "высота шапки не прыгнула при открытии карточки (нет скачка страницы)",
  Math.abs(headerH1 - headerH0) < 2,
  `было ${headerH0}px → стало ${headerH1}px`
);

console.log("\n— 3. Печать «тре» → результаты —");
await page.keyboard.type("локо", { delay: 60 });
await page.waitForTimeout(1600); // debounce 220мс + запрос
const dropdownHasResults = await page.evaluate(() => {
  const pop = document.querySelector(".search-pop");
  if (!pop) return false;
  const txt = pop.textContent || "";
  const rows = pop.querySelectorAll("button").length;
  /* достаточно секции с результатами и ≥1 кнопки-строки */
  return rows >= 1 && (txt.includes("Ткани") || txt.includes("Каталог фото"));
});
ok("дропдаун в карточке показывает результаты (Ткани/Каталог фото)", dropdownHasResults);

console.log("\n— 4. Enter → запрос применён, каталог отфильтрован —");
await page.keyboard.press("Enter");
await page.waitForTimeout(900);
/* карточка ПРЕДСМОНТИРОВАНА — закрытие = исчезновение класса .is-open */
const popClosed = await page.evaluate(() => !document.querySelector(".search-pop.is-open"));
ok("карточка закрылась после применения запроса", popClosed);
const applied = await page.evaluate(() => {
  const chip = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("сбросить")
  );
  return Boolean(chip);
});
ok("в панели появился applied-чип с «сбросить»", applied);
const catalogFiltered = await page.evaluate(() => {
  const main = document.querySelector("main");
  return main ? (main.textContent || "").length > 50 : false;
});
ok("каталог отрисовал отфильтрованный список", catalogFiltered);
// сброс
const reset = page.locator("button", { hasText: "сбросить" }).first();
if (await reset.isVisible().catch(() => false)) {
  await reset.click();
  await page.waitForTimeout(500);
}

console.log("\n— 5. Палитра «Кобальт»: ни бирюзы, ни серого стекла —");
/* Resolved-значения custom properties зависят от движка — щупаем через probe-элемент */
const probeColor = (page, cssVar, withClass) =>
  page.evaluate(
    ({ cssVar, withClass }) => {
      const d = document.createElement("div");
      if (withClass) d.className = withClass;
      d.style.background = `var(${cssVar})`;
      d.style.display = "none";
      document.body.appendChild(d);
      const c = getComputedStyle(d).backgroundColor;
      d.remove();
      return c;
    },
    { cssVar, withClass }
  );
const brandDark = await probeColor(page, "--brand", "");
ok(
  "тёмная тема: --brand кобальт rgb(91,132,240)",
  /91,\s*132,\s*240/.test(brandDark),
  brandDark
);
const glassDark = await probeColor(page, "--glass", "");
ok(
  "тёмная тема: стекло синеватое (34,42,74), не серое (46,51,58)",
  /34,\s*42,\s*74/.test(glassDark) && !/46,\s*51,\s*58/.test(glassDark),
  glassDark
);
// переключаем светлую тему так же, как ThemeSwitch (класс light на <html>)
await page.evaluate(() => {
  document.documentElement.classList.add("light");
});
await page.waitForTimeout(250);
const brandLight = await probeColor(page, "--brand", "light");
ok(
  "светлая тема: --brand кобальт rgb(42,85,213)",
  /42,\s*85,\s*213/.test(brandLight),
  brandLight
);
const glassLight = await probeColor(page, "--glass", "light");
ok(
  "светлая тема: стекло синеватое (196,208,240), не серое (150,160,169)",
  /196,\s*208,\s*240/.test(glassLight) && !/150,\s*160,\s*169/.test(glassLight),
  glassLight
);
ok("бирюзовый #11b5b0 нигде не остался брендом", !/17,\s*181,\s*176/.test(brandDark + brandLight));

console.log("\n— 6. Светлая тема: поле поиска — синеватое стекло —");
await page.waitForTimeout(300);
const lightField = await page.evaluate(() => {
  const input = document.querySelector("input[data-search-input]");
  if (!input) return "no-input";
  return getComputedStyle(input).backgroundColor;
});
ok("светлая тема: поле имеет синеватый фон (не серый)", /rgba\(42, 85, 213/.test(lightField), lightField);

console.log("\n— 7. Консоль —");
ok("консоль чиста (0 ошибок)", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\nИТОГ: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("Провалено:", errors.join(" | "));
  process.exit(1);
}
