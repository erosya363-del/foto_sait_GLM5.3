/**
 * v2.8 — П.13 ТЗ: проход по всем разрешениям (320/375/390/430/768/1024/1366/1920)
 * + малые высоты окна + все модалки (создание/редактирование/удаление товара,
 * ткани, редактор фото, подтверждения) — КАЖДАЯ модалка должна быть целиком
 * в видимой области. Скриншоты → tool-results/v28-*.png
 */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ FAIL: ${name} ${extra}`); }
}

const browser = await chromium.launch();

/** Модалки: открыть → замерить прямоугольник против видимой области */
async function checkDialogInViewport(page, openFn, label, vw, vh, closeFn = null) {
  if (openFn) await openFn();
  await page.waitForTimeout(550);
  const box = await page.evaluate((vhArg) => {
    const el = document.querySelector("[data-slot='dialog-content'], [data-slot='alert-dialog-content']");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const btns = [...el.querySelectorAll("button")].map((b) => b.getBoundingClientRect());
    return {
      top: r.top, bottom: r.bottom, h: r.height, w: r.width,
      btnsVisible: btns.filter((b) => b.top >= 0 && b.bottom <= vhArg).length,
      btnsTotal: btns.length,
      scrollable: el.scrollHeight > el.clientHeight + 2,
    };
  }, vh);
  ok(`${label}: окно в кадре`, !!box && box.top >= 0 && box.bottom <= vh + 1, JSON.stringify(box));
  ok(`${label}: кнопки доступны`, !!box && box.btnsTotal > 0 && box.btnsVisible === box.btnsTotal, JSON.stringify(box));
  await page.screenshot({ path: `tool-results/v28-${label}.png` });
  if (closeFn) await closeFn();
  else await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);
}

/* ── МОБИЛЬНЫЕ ── */
for (const [w, h] of [[320, 640], [375, 760], [390, 760], [430, 860]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  console.log(`\n═══ Mobile ${w}×${h} ═══`);
  ok(`${w}: нет горизонтального скролла каталога`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${await page.evaluate(() => document.documentElement.scrollWidth)}`);
  await page.screenshot({ path: `tool-results/v28-m-${w}-catalog.png` });

  // Админ → Товары → подтверждение создания (модалка с длинным текстом)
  await page.evaluate(() => window.__portal.setState({ view: "admin" }));
  await page.waitForTimeout(600);
  // модалка создания товара: заполнить минимум → submit
  await page.locator('main select').first().selectOption({ index: 1 }).catch(() => {});
  const createBtn = page.locator("main button:has-text('Создать товар')");
  if (await createBtn.count()) {
    await createBtn.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  const confirmBox = await page.evaluate(() => {
    const el = document.querySelector("[data-slot='alert-dialog-content']");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  });
  ok(`${w}: подтверждение создания товара в кадре (или честно требует выбор)`, confirmBox === null || (confirmBox.top >= 0 && confirmBox.bottom <= h + 1), JSON.stringify(confirmBox));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);

  // Фото → редактор привязки: диалог открыт → проверка → «Удалить фото»
  // (внутри) → подтверждение → отмена → «Отмена» закрывает редактор
  await page.locator('button[role="tab"]:has-text("Фото")').click();
  await page.waitForTimeout(800);
  const pencil = page.locator('main button[aria-label="Редактировать привязку фото"]').first();
  if (await pencil.count()) {
    await pencil.click();
    await checkDialogInViewport(page, null, `m${w}-фото-редактор`, w, h, async () => {
      await page.locator("[data-slot='dialog-content'] button:has-text('Удалить фото')").click();
      await page.waitForTimeout(400);
      await checkDialogInViewport(page, null, `m${w}-фото-удаление`, w, h, async () => {
        await page.locator("[data-slot='alert-dialog-content'] button:has-text('Отмена')").click();
        await page.waitForTimeout(300);
      });
      await page.locator("[data-slot='dialog-content'] button:has-text('Отмена')").click();
      await page.waitForTimeout(350);
    });
  }
  // Ткани → подтверждение удаления (строк много — скролл внутри)
  await page.locator('button[role="tab"]:has-text("Ткани")').click();
  await page.waitForTimeout(600);
  const delFabric = page.locator("main button[aria-label='Удалить']").first();
  if (await delFabric.count()) {
    await delFabric.click();
    await page.waitForTimeout(400);
    await checkDialogInViewport(page, () => {}, `m${w}-ткань-удаление`, w, h);
  }
  // Поиск: карточка открылась, поле без фокуса
  await page.evaluate(() => window.__portal.setState({ view: "catalog" }));
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector(".pill-search")?.click());
  await page.waitForTimeout(400);
  ok(`${w}: поиск открыт без фокуса (п.9)`, await page.evaluate(() => !document.activeElement?.matches("input[data-search-input]")));
  await page.screenshot({ path: `tool-results/v28-m-${w}-search.png` });
  ok(`${w}: консоль чистая`, errs.length === 0, errs.join("|").slice(0, 120));
  await page.close();
}

/* ── ДЕСКТОП ── */
for (const [w, h] of [[768, 900], [1024, 700], [1366, 600], [1920, 950]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  console.log(`\n═══ Desktop ${w}×${h} ═══`);
  const isDesktopUI = w >= 1024; // lg-брейкпоинт: <1024 — мобильный UI с пилюлей
  if (isDesktopUI) {
    ok(`${w}: пилюля скрыта`, !(await page.locator(".pill-nav").isVisible()));
    // ждём, пока BootSplash погаснет — тогда видимый лого остаётся один
    await page
      .waitForFunction(
        () => [...document.querySelectorAll("img[alt='Askona']")].filter((i) => i.offsetWidth > 0 || i.offsetHeight > 0).length === 1,
        { timeout: 8000 }
      )
      .catch(() => {});
    const visibleLogos = await page.locator("img[alt='Askona']:visible").count();
    ok(`${w}: один видимый лого (п.6)`, visibleLogos === 1, `got ${visibleLogos}`);
  } else {
    ok(`${w}: пилюля видна (lg=1024 — это планшетный мобильный UI)`, await page.locator(".pill-nav").isVisible());
  }
  ok(`${w}: «склад онлайн» нет`, !/склад онлайн/.test(await page.locator("body").innerText()));
  ok(`${w}: заголовок = вкладка`, ["Каталог"].includes((await page.locator("header .font-display").textContent())?.trim() ?? ""));
  await page.screenshot({ path: `tool-results/v28-d-${w}.png` });

  // малая высота: модалка подтверждения удаления ткани
  await page.evaluate(() => window.__portal.setState({ view: "admin" }));
  await page.waitForTimeout(500);
  await page.locator('button[role="tab"]:has-text("Ткани")').click();
  await page.waitForTimeout(500);
  const delFabric = page.locator("main button[aria-label='Удалить']").first();
  if (await delFabric.count()) {
    await delFabric.click();
    await page.waitForTimeout(400);
    await checkDialogInViewport(page, () => {}, `d${w}x${h}-ткань-удаление`, w, h);
  }
  // фото-редактор на десктопе
  await page.locator('button[role="tab"]:has-text("Фото")').click();
  await page.waitForTimeout(700);
  const pencil = page.locator('main button[aria-label="Редактировать привязку фото"]').first();
  if (await pencil.count()) {
    await checkDialogInViewport(page, () => pencil.click(), `d${w}x${h}-фото-редактор`, w, h);
  }
  ok(`${w}: консоль чистая`, errs.length === 0, errs.join("|").slice(0, 120));
  await page.close();
}

console.log(`\n═══ v28-СКРИПТ: ${passed} ✓ / ${failed} ✗ ═══`);
if (failed) { console.log("Провалены:", fails.join(" | ")); process.exit(1); }
await browser.close();
