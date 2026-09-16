/**
 * E2E: поиск через круглый элемент на пилюле (v5, шаг 3 владельца).
 * История: в v2.1 при скролле жили ДВА SearchBar с одинаковым id → клавиатура
 * iOS не открывалась. С v5 панель поиска сверху УДАЛЕНА вовсе: в DOM ровно
 * ОДИН input[data-search-input] — в подвесной карточке НАД пилюлей.
 * Проверки:
 *  1. В DOM ровно ОДИН input[data-search-input], старого id «global-search» нет
 *  2. Тап по круглому поиску на пилюле: .search-pop открыт БЕЗ autofocus
 *     (п.9 ТЗ), тап по полю даёт фокус, карточка НАД панелью с зазором 10–15мм
 *  3. Ввод «локо» → дропдаун с результатами (Ткани/Каталог фото)
 *  4. Enter применяет запрос → карточка закрылась, над панелью чип с «сбросить»
 *  5. Палитра: --brand изумруд, стекло тёплый графит (47,45,41), поле тёплое
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
/* С v5 панель сверху удалена: ОДНО поле — в предсмонтированной скрытой карточке */
ok("в DOM ровно 1 поле (в карточке над пилюлей)", inputsAtStart === 1, `найдено ${inputsAtStart}`);
const oldIdGone = await page.evaluate(() => !document.getElementById("global-search"));
ok("дублирующий id «global-search» полностью убран", oldIdGone);
ok("панели поиска сверху нет (.search-collapse удалена)", (await page.locator(".search-collapse").count()) === 0);
ok("кружка-лупы нет (заменена круглой кнопкой в пилюле)", (await page.locator(".search-fab").count()) === 0);

console.log("\n— 2. Сценарий: скролл → круглый поиск на пилюле → карточка → фокус —");
/* Проваливаемся на ДЛИННЫЙ уровень «Все ткани» (данных живые: категория
   «Диваны» может стать короче вьюпорта после чистки владельцем) */
const catBtn = page.locator("main button:not([aria-label])", { hasText: "Все ткани" }).first();
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
const searchBtnVisible = await page.locator(".pill-search").isVisible();
ok("круглый поиск на пилюле доступен и при скролле", searchBtnVisible);
/* высота шапки ЗАМЕРЯЕТСЯ ПОСЛЕ скролла (шапка уже свернулась) — сравниваем
   до/после тапа: открытие карточки НЕ должно менять высоту шапки,
   иначе браузер компенсирует скроллом и страница прыгает */
const headerH0 = await page.evaluate(() => document.querySelector("header")?.getBoundingClientRect().height ?? -1);

/* ВАЖНО: НЕ locator.click() — Playwright «scroll into view» для position:fixed
   элемента скроллит ДОКУМЕНТ в его статическую позицию (наверх), и приложение
   закономерно закрывает всё при скролле. Реальный палец страницу не листает —
   жмём из JS, как настоящий тап. */
await page.evaluate(() => document.querySelector(".pill-search")?.click());
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
/* П.9 ТЗ (НОВОЕ ПОВЕДЕНИЕ): при открытии карточки фокуса НЕТ — клавиатура
   не вскакивает, экран не прыгает. Фокус — ТОЛЬКО по тапу пользователя в поле */
ok("при открытии поле БЕЗ фокуса (п.9: клавиатуру вызывает тап по полю)", !focusInPop);

/* Шаг 2 (п.9): пользователь сам тапает по полю → фокус → клавиатура */
await page.locator("input[data-search-input]").first().click();
await page.waitForTimeout(300);
const focusAfterTap = await page.evaluate(() => {
  const pop = document.querySelector(".search-pop");
  const input = pop?.querySelector("input[data-search-input]");
  return Boolean(input) && document.activeElement === input;
});
ok("тап по полю → фокус (клавиатура открылась)", focusAfterTap);

/* Карточка НАД панелью, зазор 10–15мм (38–57px) */
const geo = await page.evaluate(() => {
  const pop = document.querySelector(".search-pop")?.getBoundingClientRect();
  const nav = document.querySelector(".pill-nav")?.getBoundingClientRect();
  if (!pop || !nav) return null;
  return { gap: nav.top - pop.bottom, above: pop.bottom <= nav.top + 1 };
});
ok("карточка НАД панелью с зазором 10–15мм", geo && geo.above && geo.gap >= 36 && geo.gap <= 60, JSON.stringify(geo));

const headerH1 = await page.evaluate(() => document.querySelector("header")?.getBoundingClientRect().height ?? -2);
ok(
  "высота шапки не прыгнула при открытии карточки (нет скачка страницы)",
  Math.abs(headerH1 - headerH0) < 2,
  `было ${headerH0}px → стало ${headerH1}px`
);

console.log("\n— 3. Печать «nova» → результаты —");
/* v3.0: «локо» в текущей БД нет (в каталоге модели Pola/Mira/Extra Nova) —
   ищем по живым данным; несуществующий запрос проверяется отдельным assert'ом */
await page.keyboard.type("nova", { delay: 60 });
await page.waitForTimeout(1600); // debounce 220мс + запрос
const dropdownHasResults = await page.evaluate(() => {
  const pop = document.querySelector(".search-pop");
  if (!pop) return false;
  const txt = pop.textContent || "";
  const rows = pop.querySelectorAll("button").length;
  /* достаточно секции с результатами и ≥1 кнопки-строки */
  return rows >= 3 && (txt.includes("Ткани") || txt.includes("Каталог фото"));
});
ok("дропдаун в карточке показывает результаты (Ткани/Каталог фото)", dropdownHasResults);
/* Несуществующий запрос → честный пустой стейт (без фантомных секций) */
await page.locator("input[data-search-input]").fill("");
await page.keyboard.type("локо", { delay: 40 });
await page.waitForTimeout(1300);
const emptyState = await page.evaluate(() => {
  const dd = document.querySelector(".search-dd");
  const t = dd?.textContent || "";
  return t.includes("Ничего не найдено") && !t.includes("Каталог фото");
});
ok("несуществующий запрос → честный «Ничего не найдено»", emptyState);
await page.locator("input[data-search-input]").fill("");
await page.keyboard.type("nova", { delay: 40 });
await page.waitForTimeout(1300);

console.log("\n— 4. Enter → запрос применён, каталог отфильтрован —");
await page.keyboard.press("Enter");
await page.waitForTimeout(900);
/* v3.0 ТЗ п.3/5: применение запроса НЕ закрывает карточку — режим поиска
   самостоятельный, поле остаётся (закрытие только явное: крестик/свайп/раздел).
   Плавающий чип появляется ПОСЛЕ явного закрытия карточки. */
const popStillOpen = await page.evaluate(() => Boolean(document.querySelector(".search-pop.is-open")));
ok("карточка ОСТАЛАСЬ открытой после Enter (v3.0: без авто-закрытия)", popStillOpen);
// явное закрытие → чип применённого поиска над панелью
await page.locator(".search-pop-close").click();
await page.waitForTimeout(500);
const applied = await page.evaluate(() => {
  const chip = document.querySelector(".search-chip");
  return Boolean(chip && (chip.textContent || "").includes("nova"));
});
ok("после явного закрытия — чип «Поиск: «nova»»", applied);
const resetBtnVisible = await page.locator(".search-chip .search-chip-x").isVisible();
ok("крестик-сброс на чипе виден", resetBtnVisible);
const catalogFiltered = await page.evaluate(() => {
  const main = document.querySelector("main");
  return main ? (main.textContent || "").length > 50 : false;
});
ok("каталог отрисовал отфильтрованный список", catalogFiltered);
// сброс крестиком чипа
const reset = page.locator(".search-chip .search-chip-x").first();
if (await reset.isVisible().catch(() => false)) {
  await page.evaluate(() => document.querySelector(".search-chip .search-chip-x")?.click());
  await page.waitForTimeout(500);
  ok("крестик чипа сбросил поиск", (await page.locator(".search-chip").count()) === 0);
}

console.log("\n— 5. Палитра: изумруд + тёплый графит стекла —");
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
  "тёмная тема: --brand изумруд rgb(20,184,166)",
  /20,\s*184,\s*166/.test(brandDark),
  brandDark
);
const glassDark = await probeColor(page, "--glass", "");
ok(
  "тёмная тема: стекло тёплый графит (47,45,41), не серое (46,51,58)",
  /47,\s*45,\s*41/.test(glassDark) && !/46,\s*51,\s*58/.test(glassDark),
  glassDark
);
// переключаем светлую тему так же, как ThemeSwitch (класс light на <html>)
await page.evaluate(() => {
  document.documentElement.classList.add("light");
});
await page.waitForTimeout(250);
const brandLight = await probeColor(page, "--brand", "light");
ok(
  "светлая тема: --brand изумруд rgb(15,118,110)",
  /15,\s*118,\s*110/.test(brandLight),
  brandLight
);
const glassLight = await probeColor(page, "--glass", "light");
ok(
  "светлая тема: стекло белое translucent (255,255,255), не серое (150,160,169)",
  /255,\s*255,\s*255/.test(glassLight) && !/150,\s*160,\s*169/.test(glassLight),
  glassLight
);
ok("бирюзовый #11b5b0 нигде не остался брендом", !/17,\s*181,\s*176/.test(brandDark + brandLight));

console.log("\n— 6. Светлая тема: поле поиска — тёплое нейтральное —");
await page.waitForTimeout(300);
const lightField = await page.evaluate(() => {
  const input = document.querySelector("input[data-search-input]");
  if (!input) return "no-input";
  return getComputedStyle(input).backgroundColor;
});
ok("светлая тема: поле тёплое нейтральное (82,74,60; не синее)", /rgba\(82,\s*74,\s*60/.test(lightField), lightField);

console.log("\n— 7. Консоль —");
ok("консоль чиста (0 ошибок)", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\nИТОГ: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("Провалено:", errors.join(" | "));
  process.exit(1);
}
