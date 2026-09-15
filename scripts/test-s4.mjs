/**
 * E2E Шаг 4 + регресс Шагов 1–3 (после восстановления).
 * Запуск: node scripts/test-s4.mjs (сервер должен быть на :3000)
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

console.log("── 1. Уровень 1: лента новинок + «Все ткани» ──");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

const freshSection = page.locator('section[aria-label="Новинки за 7 дней"]');
ok("лента «Новинки за 7 дней» видна", await freshSection.isVisible());
const freshCards = page.locator('section[aria-label="Новинки за 7 дней"] button');
ok("лента содержит карточки", (await freshCards.count()) > 0);
const stripNew = await page.locator('section[aria-label="Новинки за 7 дней"] span:has-text("NEW")').count();
ok("NEW-бейджи в ленте", stripNew > 0);

const fabricsBtn = page.locator('button:has-text("Все ткани")').first();
ok("кнопка «Все ткани» видна", await fabricsBtn.isVisible());

console.log("── 2. Лента: тап по карточке → товар ──");
await freshCards.first().click();
await page.waitForTimeout(700);
ok("товар открыт из ленты", await page.locator('button[aria-label="Назад"]').first().isVisible());
const prodCrumbs = await page.getByText("Каталог", { exact: true }).count();
ok("крошки в товаре есть", prodCrumbs > 0);

console.log("── 3. Повторный тап «Каталог» = мгновенный верх (Шаг 2) ──");
const catNav = page.locator('nav.pill-nav button:has-text("Каталог")');
await catNav.click();
await page.waitForTimeout(400);
const scrollY = await page.evaluate(() => window.scrollY);
ok("scrollY = 0 после повторного тапа", scrollY === 0, `(got ${scrollY})`);
ok("вернулись на уровень 1 (кнопка «Все ткани» видна)", await fabricsBtn.isVisible());

console.log("── 4. Экран «Все ткани» ──");
await fabricsBtn.click();
await page.waitForTimeout(900);
const title = await page.locator("header span").first().textContent();
ok("заголовок фиксированный «Askona Каталог» (Шаг 6)", title?.trim() === "Askona Каталог", `(got «${title}»)`);
ok("крошка «Все ткани» на месте", (await page.locator('[role="navigation"]:has-text("Все ткани")').count()) > 0);
const fabricCards = page.locator("main button:has(img)");
ok("карточки тканей есть", (await fabricCards.count()) > 0, `(${await fabricCards.count()})`);
const fabricNew = await page.locator("main span:has-text('NEW')").count();
ok("NEW-бейджи на тканях (данные за 7 дней)", fabricNew > 0);

console.log("── 5. Ткань → её варианты + крошки ──");
/* Данные живые: у части тканей варианты без фото (пользователь удаляет из
   админки). Открываем ткань, у которой точно есть фото у вариантов (thumb из
   API ставится только из фото вариантов), иначе проверка img теряет смысл. */
const fabApi = await (await fetch(`${BASE}/api/catalog?level=fabrics`)).json();
const withPhotos = (fabApi.fabrics ?? []).filter((f) => f.thumb);
const fabricName = withPhotos[0]?.name;
if (!fabricName) {
  ok("есть ткань с фото вариантов (API)", false, "ни у одной ткани нет thumb");
} else {
  await page.locator(`main button:has-text("${fabricName}")`).first().click();
  await page.waitForTimeout(900);
const title2 = await page.locator("header span").first().textContent();
ok("заголовок остаётся «Askona Каталог» (Шаг 6)", title2?.trim() === "Askona Каталог", `(got «${title2}»)`);
ok(`крошка-ткань показывает имя (${fabricName})`, (await page.locator(`[role="navigation"]:has-text("${fabricName}")`).count()) > 0);
ok("крошка «Все ткани» тапабельна", await page.locator('button:has-text("Все ткани")').first().isVisible());
ok("варианты ткани показаны", (await page.locator("main button:has(img)").count()) > 0);
// тап по «Все ткани» в крошках — назад к списку тканей
await page.locator('button:has-text("Все ткани")').first().click();
await page.waitForTimeout(600);
ok("вернулись к списку тканей", (await fabricCards.count()) > 0);
}
console.log("── 6. Назад (кнопка шапки) → уровень 1 ──");
await page.locator('header button[aria-label="Назад"]').first().click();
await page.waitForTimeout(500);
ok("«Назад» вернул на уровень 1", await fabricsBtn.isVisible());

console.log("── 7. Категория → модели: крошки + NEW (Шаг 3) ──");
await page.locator('main button:has-text("Диваны")').first().click();
await page.waitForTimeout(900);
const catCrumb = await page.locator('[role="navigation"][aria-label="Путь в каталоге"] button:has-text("Каталог")').count();
ok("крошки на уровне моделей", catCrumb > 0);
const modelNew = await page.locator("main span:has-text('NEW')").count();
if (modelNew > 0) ok("NEW-бейдж на модели", true);
else console.log("  ~ NEW-моделей в данных нет — проверка бейджа пропущена");

console.log("── 8. Модель → варианты: крошки + NEW ──");
/* «Магни» и другие модели без фото теперь скрыты (правило «нет фото — нет узла»)
   — кликаем первую ВИДИМУЮ модель (строка со счётчиком «вариантов фото»). */
await page.locator("main button:has-text('вариантов фото')").first().click();
await page.waitForTimeout(900);
const modelCrumb = await page.locator('[role="navigation"][aria-label="Путь в каталоге"] button:has-text("Диваны")').count();
ok("крошка «Диваны» тапабельна на уровне вариантов", modelCrumb > 0);
const variantNew = await page.locator("main span:has-text('NEW')").count();
ok("NEW-бейджи на вариантах", variantNew > 0);

console.log("── 9. Прыжок из товара по крошке (Шаг 3) ──");
/* Данные живые (пользователь удаляет/меняет фото из админки) — у части
   вариантов фото может не быть. Берём карточку с фото, если есть, иначе любую. */
const imgCard = page.locator("main button:has(img)").first();
const anyCard = page.locator("main button.card-hover").first();
const target = (await imgCard.count()) > 0 ? imgCard : anyCard;
await target.click();
await page.waitForTimeout(800);
ok("товар открыт", await page.locator('header button[aria-label="Назад"]').first().isVisible());
await page.locator('[role="navigation"][aria-label="Путь в каталоге"] button:has-text("Диваны")').first().click();
await page.waitForTimeout(700);
ok("прыжок: товар закрыт, уровень моделей", (await page.locator("main button:has-text('вариантов фото')").count()) > 0);

console.log("── 10. Поиск: крошки + NEW ──");
await page.locator('nav.pill-nav button:has-text("Каталог")').click();
await page.waitForTimeout(300);
await page.fill("input[data-search-input]", "sky");
await page.press("input[data-search-input]", "Enter");
await page.waitForTimeout(900);
const searchCrumb = await page.locator('[role="navigation"][aria-label="Путь в каталоге"] span:has-text("Поиск:")').count();
ok("крошка «Поиск: «sky»»", searchCrumb > 0);
const searchNew = await page.locator("main span:has-text('NEW')").count();
ok("NEW-бейджи в поиске", searchNew > 0);

console.log("── 11. Склад: пружинный сегмент-контрол (Шаг 1) ──");
await page.locator('nav.pill-nav button:has-text("Остатки")').click();
await page.waitForTimeout(900);
const seg = page.locator('[role="tablist"][aria-label="Склад"]');
ok("сегмент-контрол складов виден", await seg.isVisible());
await seg.locator('button:has-text("Владимир")').click();
await page.waitForTimeout(600);
ok("переключение на Владимир", (await seg.locator('button[aria-selected="true"]').textContent())?.includes("Владимир"));

console.log("── 12. Фикс полосы v3: CSS ──");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const css = await page.evaluate(() => {
  const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
  const skirt = document.querySelector(".fx-skirt");
  const skirtBg = skirt ? getComputedStyle(skirt).backgroundImage : "none";
  const skirtH = skirt ? getComputedStyle(skirt).height : "0";
  const bodyBg = getComputedStyle(document.body).backgroundImage;
  return { htmlBg, skirtBg, skirtH, skirtCount: document.querySelectorAll(".fx-skirt").length, hasBodyLayers: bodyBg.split("),").length };
});
ok("html bg = rgb(14, 19, 34)", css.htmlBg === "rgb(14, 19, 34)", `(got ${css.htmlBg})`);
ok(".fx-skirt есть", css.skirtCount === 1);
ok("юбка 96px", css.skirtH === "96px", `(got ${css.skirtH})`);
ok("юбка залита --edge", /rgb\(14, 19, 34\)/.test(css.skirtBg));
ok("градиенты запечены в body (≥4 слоя)", css.hasBodyLayers >= 4, `(${css.hasBodyLayers})`);

console.log("── 13. Консоль ──");
const realErrors = consoleErrors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
ok("консоль без ошибок", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

await page.screenshot({ path: "scripts/s4-l1-final.png", fullPage: false });
await browser.close();

console.log(`\n══ ИТОГ: ${passed} ✓ / ${failed} ✗ ══`);
if (failed > 0) {
  console.log("Провалено:", errors.join("; "));
  process.exit(1);
}
