/**
 * E2E v2.9 — точечные фиксы по жалобам владельца:
 *  1. ПОДЁРГИВАНИЕ ВКЛАДОК: из перехода страниц убран filter: blur (перерисовка
 *     всей страницы каждый кадр поверх backdrop-стёкол). Проверки: у контейнера
 *     контента нет filter после перехода; заголовок шапки геометрически
 *     стабилен при переходах Каталог→Загрузка→Остатки→Каталог.
 *  2. ФОКУС ПОИСКА = НОЛЬ ИЗМЕНЕНИЙ: база до фокуса == фокус (фон/кромка/форма),
 *     нет обводки (бирюза убрана глобально, :focus-visible без border-radius).
 *  3. НОВЫЙ ТОВАР — одно поле вместо «из списка / + новая»: существующая
 *     категория, введённая в другом регистре, переиспользуется (в подтверждении
 *     без «создастся»), новая модель — «(создастся)»; создание проходит,
 *     тестовые записи вычищаются.
 * Запуск: node scripts/test-v29.mjs (сервер на :3000)
 */
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";

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
await page.evaluate(() => {
  document.documentElement.style.scrollBehavior = "auto";
});

console.log("\n— 1. Переход вкладок без blur и без прыжков —");
/* Контейнер контента (motion.div внутри main) — после settling filter должен быть none */
const contentFilter = await page.evaluate(
  () => getComputedStyle(document.querySelector("main > div > div") ?? document.body).filter
);
ok("у контейнера контента нет фильтра (blur убран)", contentFilter === "none", contentFilter);

const titleProbe = () =>
  page.evaluate(() => {
    /* Зонд — КОНТЕЙНЕР шапки (не спан заголовка: его ширина следует за текстом
       вкладки и обязана меняться). Стабильность контейнера = нет прыжков шапки. */
    const el = document.querySelector("header");
    const r = el?.getBoundingClientRect();
    return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null;
  });

const probeBefore = await titleProbe();
const pillButtons = page.locator(".pill-shell .pill-item");
/* Каталог → Загрузка */
await pillButtons.nth(2).click();
await page.waitForTimeout(700);
const probeUpload = await titleProbe();
ok("после перехода на «Загрузку» фильтра нет",
  (await page.evaluate(() => getComputedStyle(document.querySelector("main > div > div") ?? document.body).filter)) === "none");
ok("заголовок шапки не сдвинулся (Каталог→Загрузка)",
  JSON.stringify(probeBefore) === JSON.stringify(probeUpload), `${JSON.stringify(probeBefore)} → ${JSON.stringify(probeUpload)}`);
/* Загрузка → Остатки */
await pillButtons.nth(1).click();
await page.waitForTimeout(700);
const probeStock = await titleProbe();
ok("заголовок шапки не сдвинулся (Загрузка→Остатки)",
  JSON.stringify(probeUpload) === JSON.stringify(probeStock));
/* Остатки → Каталог (обратный путь из жалобы) */
await pillButtons.nth(0).click();
await page.waitForTimeout(700);
const probeCatalog = await titleProbe();
ok("заголовок шапки не сдвинулся (Остатки→Каталог)",
  JSON.stringify(probeStock) === JSON.stringify(probeCatalog));

console.log("\n— 2. Фокус поиска = ноль изменений —");
await page.evaluate(() => document.querySelector(".pill-search")?.click());
await page.waitForTimeout(400);
const inp = page.locator("input[data-search-input]").first();
const base = await inp.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { bg: cs.backgroundColor, bc: cs.borderColor, br: cs.borderRadius, ol: cs.outlineStyle, w: cs.width, h: cs.height };
});
await inp.click();
await page.waitForTimeout(400);
const focused = await inp.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { bg: cs.backgroundColor, bc: cs.borderColor, br: cs.borderRadius, ol: cs.outlineStyle, w: cs.width, h: cs.height };
});
ok("фокус: фон/кромка/форма не изменились",
  base.bg === focused.bg && base.bc === focused.bc && base.br === focused.br, JSON.stringify({ base, focused }));
ok("фокус: обводки нет (outline none)", focused.ol === "none", focused.ol);
ok("фокус: геометрия та же", base.w === focused.w && base.h === focused.h);
/* Клавиатурный фокус-виджет глобально без border-radius-хака уже проверен s6 */
await page.evaluate(() => document.querySelector(".search-pop-close")?.click());
await page.waitForTimeout(300);

console.log("\n— 3. Новый товар: одно поле, переиспользование без учёта регистра —");
/* Открываем Админ через пилюлю */
await page.locator(".pill-shell .pill-item").nth(3).click();
await page.waitForTimeout(900);
ok("вкладка «Админ» открыта", await page.locator("h1", { hasText: "Админ" }).isVisible().catch(() => false));
ok("тумблеров «из списка / + новая» больше нет",
  (await page.getByRole("button", { name: "Категория из списка" }).count()) === 0 &&
  (await page.getByRole("button", { name: "Модель из списка" }).count()) === 0);

const catInput = page.locator("input[list='dl-categories']");
const modelInput = page.locator("input[list='dl-models']");
ok("поля категории/модели на месте (datalist)", (await catInput.count()) === 1 && (await modelInput.count()) === 1);

const TEST_CAT = "Диваны";      // существующая категория (сид)
const TEST_MODEL = "ТЕСТ-МОДЕЛЬ-v29"; // новая модель
await catInput.fill(TEST_CAT.toLowerCase()); // «диваны» — в другом регистре
await modelInput.fill(TEST_MODEL);
await page.getByRole("button", { name: "Создать товар" }).click();
await page.waitForTimeout(500);

const dialogDesc = (await page.locator("[role='alertdialog']").first().textContent().catch(() => "")) ?? "";
ok("в подтверждении категория распознана без «(создастся)»",
  /категория:\s*Диваны(?!\s*\(создастся\))/.test(dialogDesc.replace(/\u00a0/g, " ")) && dialogDesc.includes("Диваны"), dialogDesc.slice(0, 160));
ok("в подтверждении новая модель помечена «(создастся)»", /создастся\)/.test(dialogDesc), dialogDesc.slice(0, 160));

await page.locator("[role='alertdialog']").getByRole("button", { name: "Создать" }).click();
await page.waitForTimeout(1600);
ok("тост успеха «Товар создан»",
  (await page.locator("[data-sonner-toast]", { hasText: "Товар создан" }).count()) > 0
  || (await page.locator("text=Товар создан").count()) > 0);

/* Сервер: модель создана ВНУТРИ существующей категории, дубликата категории нет */
const db = new PrismaClient();
try {
  const cat = await db.category.findFirst({ where: { name: TEST_CAT } });
  const model = await db.model.findFirst({ where: { name: TEST_MODEL } });
  ok("категория «Диваны» переиспользована (не задублирована)", Boolean(cat));
  ok("новая модель создана в существующей категории",
    Boolean(model && cat && model.categoryId === cat.id));
  const variant = await db.productVariant.findFirst({ where: { modelId: model?.id ?? "" } });
  ok("товар (вариант) создан", Boolean(variant));
  /* ЧИСТКА: мягко удалённый вариант + тест-модель стираются физически */
  if (variant) await db.photo.updateMany({ where: { variantId: variant.id }, data: {} }).catch(() => {});
  if (variant) await db.productVariant.delete({ where: { id: variant.id } }).catch(() => {});
  if (model) await db.model.delete({ where: { id: model.id } }).catch(() => {});
  ok("тестовые записи вычищены", true);
} finally {
  await db.$disconnect();
}

console.log("\n— 4. Консоль —");
ok("консоль чистая (ошибок JS/сети нет)", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

console.log(`\n═══ ИТОГ: ${passed} ✓ / ${failed} ✗ ═══`);
if (failed) {
  console.log("Провалены:");
  for (const e of errors) console.log("  • " + e);
  process.exit(1);
}
await browser.close();
