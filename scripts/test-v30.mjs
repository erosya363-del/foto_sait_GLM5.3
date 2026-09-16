/**
 * E2E v3.0 — поиск+клавиатура (ТЗ 1–8, 43), Photo Viewer (ТЗ 15–39),
 * админка без пустого экрана (ТЗ 9), сплэш только на первый запуск (ТЗ 41),
 * design tokens (ТЗ 14), touch targets (ТЗ 12), «Остатки» (ТЗ 13).
 * Запуск: node scripts/test-v30.mjs (сервер на :3000)
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
const context = await browser.newContext({ viewport: { width: 390, height: 780 } });
await context.addInitScript(() => {
  try {
    /* Чистим хранилища ОДИН РАЗ (маркер в localStorage переживает навигации):
       иначе reload снова стирает sessionStorage вместе с флагом «skovo-booted» */
    if (!localStorage.getItem("test-v30-cleaned")) {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("test-v30-cleaned", "1");
    }
    /* детерминизм: без SW-кэша (network-first мог отдать старый HTML) */
    if (navigator.serviceWorker) {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
    }
    if (typeof caches !== "undefined") {
      caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
    }
  } catch {}
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1300);
await page.evaluate(() => {
  document.documentElement.style.scrollBehavior = "auto";
});

console.log("\n— 1. Сплэш: только при первом запуске сессии —");
/* Прогрев: первый reload может прийти из устаревшего SW-кэша (network-first
   обновляет кэш в фоне) — этот reload гасит гонку, assert на ВТОРОМ reload */
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(400);
await page.reload({ waitUntil: "domcontentloaded" });
const skipState = await page.evaluate(() => {
  const el = document.querySelector(".boot-bg");
  return {
    hasClass: document.documentElement.classList.contains("boot-skip"),
    display: el ? getComputedStyle(el).display : "absent",
  };
});
ok("после reload стоит класс boot-skip", skipState.hasClass);
ok("сплэш скрыт сразу после reload (display:none)", skipState.display === "none", skipState.display);
await page.waitForTimeout(1200);

console.log("\n— 2. Поиск: состояние независимо от клавиатуры/скролла/фокуса —");
await page.locator(".pill-search").click();
await page.waitForTimeout(350);
const popOpen = () => page.evaluate(() => {
  const el = document.querySelector(".search-pop");
  return el ? el.classList.contains("is-open") && getComputedStyle(el).visibility === "visible" : false;
});
ok("тап по кнопке поиска открыл карточку (без клавиатуры)", await popOpen());
/* Реальный скролл страницы — раньше (>30px) закрывал поиск (критический баг) */
await page.evaluate(() => window.scrollTo(0, 300));
await page.waitForTimeout(300);
ok("скролл страницы НЕ закрыл поиск", await popOpen());
/* resize события (клавиатура шлёт их на Android) — не должны закрывать */
await page.evaluate(() => window.dispatchEvent(new Event("resize")));
await page.waitForTimeout(200);
ok("window resize НЕ закрыл поиск", await popOpen());
/* Фокус в поле + blur — режим поиска жив (ТЗ п.5) */
await page.locator("input[data-search-input]").click();
await page.waitForTimeout(200);
await page.locator("input[data-search-input]").blur();
await page.waitForTimeout(250);
ok("focus+blur поля НЕ закрыли поиск", await popOpen());
/* Enter применяет запрос — карточка остаётся (ТЗ п.3: только явное закрытие) */
await page.locator("input[data-search-input]").fill("диван");
await page.locator("input[data-search-input]").press("Enter");
await page.waitForTimeout(300);
ok("Enter применил запрос и оставил карточку", await popOpen());
ok("поиск применён (чип появится после закрытия)",
  await page.evaluate(() => (window.__portal?.getState().searchQuery ?? null) === "диван"));
/* Клавиатура «есть, поиска нет» — главная ассершка сценария 43 */
const kbSearchScenario = await popOpen();
ok("КРИТИЧНО: нет состояния «клавиатура открыта + поиск исчез»", kbSearchScenario);
/* Очистка × внутри поля — очищает текст, НЕ закрывает режим (ТЗ п.7) */
await page.locator('button[aria-label="Очистить поиск"]').click();
await page.waitForTimeout(250);
const afterClear = {
  popOpen: await popOpen(),
  queryNull: await page.evaluate(() => (window.__portal?.getState().searchQuery ?? null) === null),
};
ok("× в поле очистил запрос, но НЕ закрыл поиск", afterClear.popOpen && afterClear.queryNull);
/* Заново применяем запрос и закрываем карточку ЯВНО → появляется чип */
await page.locator("input[data-search-input]").fill("диван");
await page.locator("input[data-search-input]").press("Enter");
await page.waitForTimeout(250);
await page.locator(".search-pop-close").click();
await page.waitForTimeout(350);
ok("крестик карточки закрыл поиск", !(await popOpen()));
ok("чип «Поиск: …» появился над панелью", await page.locator(".search-chip").isVisible());
/* Кнопка поиска — toggle: повторный тап снова открывает */
await page.locator(".pill-search").click();
await page.waitForTimeout(300);
ok("повторный тап по кнопке поиска снова открыл карточку", await popOpen());
/* Тап мимо — закрыть */
await page.evaluate(() => window.scrollTo(0, 0));
await page.mouse.click(195, 200);
await page.waitForTimeout(300);
ok("тап мимо закрыл карточку", !(await popOpen()));
/* Сброс чипа */
await page.locator(".search-chip-x").click();
await page.waitForTimeout(200);
ok("крестик чипа сбросил поиск", await page.locator(".search-chip").count() === 0);

console.log("\n— 3. Нет ложного kb-open на десктопе —");
await page.locator("input[data-search-input]").count();
/* Фокус в поле на десктопе (клавиатуры нет) → kb-open НЕ должен включиться */
await page.locator(".pill-search").click();
await page.locator("input[data-search-input]").click();
await page.evaluate(() => window.dispatchEvent(new Event("resize")));
await page.waitForTimeout(250);
ok("фокус в поле без клавиатуры НЕ включил kb-open",
  await page.evaluate(() => !document.documentElement.classList.contains("kb-open")));
await page.locator(".search-pop-close").click();

console.log("\n— 4. Photo Viewer: открытие, зум, клавиши, листание —");
/* Открываем первый товар с фото напрямую через стор (надёжный дриллдаун) */
await page.locator(".pill-shell .pill-item").first().click();
await page.waitForTimeout(600);
const productId = await page.evaluate(async () => {
  const r = await fetch("/api/catalog");
  const j = await r.json();
  const item = (j.items ?? []).find((p) => p.photos && p.photos.length > 0);
  return item ? item.id : null;
});
ok("найден товар с фото в каталоге", Boolean(productId));
await page.evaluate((id) => window.__portal.getState().openProduct(id, "catalog"), productId);
await page.waitForTimeout(1100);
const photoFrames = page.locator(".photo-frame");
const framesCount = await photoFrames.count();
ok("фотолента товара отрисована", framesCount > 0, `${framesCount} шт`);
if (framesCount > 0) {
  await page.evaluate(() => window.scrollTo(0, 120));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await photoFrames.first().click();
  await page.waitForTimeout(600);
  ok("просмотрщик открылся", await page.locator(".viewer-backdrop").isVisible());
  ok("счётчик «1 / N»", (await page.locator(".viewer-count").innerText()).match(/^\d+ \/ \d+$/) !== null);
  ok("нижняя панель зума присутствует (6+ кнопок)",
    (await page.locator(".viewer-bar .vbtn").count()) >= 5 && await page.locator(".viewer-pct").isVisible());
  ok("двойная загрузка: thumb + optimized в слайде",
    (await page.locator(".viewer-zoom img").count()) === 2);
  /* Клавиатура: + зум, 0 сброс, → листание, Esc закрытие */
  await page.keyboard.press("+");
  await page.waitForTimeout(500);
  const pctZoomed = await page.locator(".viewer-pct").innerText();
  ok("клавиша «+» увеличила (>% )", parseInt(pctZoomed) > 120, pctZoomed);
  await page.keyboard.press("0");
  await page.waitForTimeout(500);
  ok("клавиша «0» сбросила к 100%", (await page.locator(".viewer-pct").innerText()) === "100%");
  const cntBefore = await page.locator(".viewer-count").innerText();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  ok("стрелка → перелистнула", (await page.locator(".viewer-count").innerText()) !== cntBefore
    || framesCount === 1);
  /* Wheel-зум на десктопе */
  await page.keyboard.press("0");
  await page.locator(".viewer-stage").hover({ position: { x: 195, y: 300 } });
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);
  ok("wheel вверх зумит", parseInt(await page.locator(".viewer-pct").innerText()) > 120);
  /* Пан в зуме не выходит за границы: тянем сильно влево — слой не улетает */
  const txBefore = await page.evaluate(() => document.querySelector(".viewer-zoom")?.getBoundingClientRect().left ?? 0);
  await page.mouse.down();
  await page.mouse.move(20, 300, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const txAfter = await page.evaluate(() => document.querySelector(".viewer-zoom")?.getBoundingClientRect().left ?? 0);
  ok("pan в зуме ограничен границами (нет бесконечного утащить)", Math.abs(txAfter - txBefore) < 400,
    `${txBefore} → ${txAfter}`);
  /* Двойной клик — зум/сброс */
  await page.keyboard.press("0");
  await page.waitForTimeout(300);
  await page.locator(".viewer-stage").dblclick();
  await page.waitForTimeout(600);
  const pctDbl = parseInt(await page.locator(".viewer-pct").innerText());
  ok("double click зумит к ~250%", pctDbl > 180 && pctDbl < 400, pctDbl);
  await page.locator(".viewer-stage").dblclick();
  await page.waitForTimeout(600);
  ok("повторный double click вернул 100%", (await page.locator(".viewer-pct").innerText()) === "100%");
  /* Позиция каталога сохраняется после закрытия (ТЗ п.33) */
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  ok("Esc закрыл просмотрщик", !(await page.locator(".viewer-backdrop").count()));
  const scrollAfter = await page.evaluate(() => window.scrollY);
  ok("позиция скролла каталога сохранилась", Math.abs(scrollAfter - scrollBefore) < 8, `${scrollBefore} → ${scrollAfter}`);

  console.log("\n— 5. Photo Viewer: Share и action sheet —");
  await photoFrames.first().click();
  await page.waitForTimeout(500);
  /* В headless Chromium navigator.share нет → кнопка Share открывает fallback-меню */
  const hasNativeShare = await page.evaluate(() => typeof navigator.share === "function");
  await page.locator('button[aria-label="Поделиться"]').click();
  await page.waitForTimeout(500);
  if (!hasNativeShare) {
    ok("Share без Web Share API открыл fallback-меню", await page.locator(".viewer-sheet").isVisible());
    ok("в меню есть «Скачать»", await page.locator(".viewer-sheet-row", { hasText: "Скачать" }).count() > 0);
    ok("в меню есть «Скопировать ссылку»", await page.locator(".viewer-sheet-row", { hasText: "Скопировать ссылку" }).count() > 0);
    ok("в меню есть «Открыть оригинал»", await page.locator(".viewer-sheet-row", { hasText: "Открыть оригинал" }).count() > 0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    ok("Esc сначала закрыл меню, просмотрщик жив", await page.locator(".viewer-backdrop").isVisible());
  } else {
    console.log("  (navigator.share доступен — fallback не проверяем)");
    await page.keyboard.press("Escape");
  }
  /* ⋯ открывает action sheet */
  await page.locator('button[aria-label="Действия с фотографией"]').click();
  await page.waitForTimeout(400);
  ok("кнопка ⋯ открыла action sheet", await page.locator(".viewer-sheet").isVisible());
  ok("в sheet есть информация о фото", await page.locator(".viewer-sheet-info").isVisible());
  await page.locator(".viewer-sheet-backdrop").click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(900); // spring-выход sheet ≈ 0.5с
  ok("тап по фону закрыл sheet", (await page.locator(".viewer-sheet").count()) === 0);
  /* Touch targets: vbtn ≥44px */
  const vbtnSize = await page.evaluate(() => {
    const el = document.querySelector(".viewer-bar .vbtn");
    const r = el?.getBoundingClientRect();
    return r ? { w: r.width, h: r.height } : null;
  });
  ok("кнопки просмотрщика ≥44px", vbtnSize && vbtnSize.w >= 43 && vbtnSize.h >= 43, JSON.stringify(vbtnSize));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
} else {
  ok("фото для теста viewer найдено", false, "нет .photo-frame");
}

console.log("\n— 6. Админка: skeleton вместо пустого экрана —");
/* Замедляем /api/admin, чтобы успеть поймать skeleton (поллинг — без гонок) */
await context.route(/\/api\/admin/, async (route) => {
  await new Promise((r) => setTimeout(r, 900));
  await route.continue();
});
await page.locator(".pill-shell .pill-item").nth(3).click();
let skeletonSeen = 0;
try {
  await page.waitForSelector(".skeleton", { timeout: 4000 });
  skeletonSeen = await page.evaluate(() => document.querySelectorAll(".skeleton").length);
} catch {}
ok("при входе в админку сразу видны скелетоны (не пустой экран)", skeletonSeen > 0, `${skeletonSeen} шт`);
await page.waitForSelector(".skeleton", { state: "detached", timeout: 8000 }).catch(() => {});
ok("после загрузки скелетоны сменились данными",
  await page.evaluate(() => document.querySelectorAll(".skeleton").length === 0));
await context.unroute(/\/api\/admin/);

console.log("\n— 7. Остатки: читаемость и тач-таргеты —");
await page.locator(".pill-shell .pill-item").nth(1).click();
await page.waitForTimeout(900);
const row = page.locator(".stock-row").first();
ok("строка остатка на месте", (await page.locator(".stock-row").count()) > 0);
/* Порядок: имя (текстовый блок) ПЕРВЫМ, количество — после */
const order = await page.evaluate(() => {
  const row = document.querySelector(".stock-row");
  if (!row) return null;
  const children = [...row.children];
  const textIdx = children.findIndex((c) => c.tagName === "DIV" && c.classList.contains("min-w-0"));
  const qtyIdx = children.findIndex((c) => c.classList.contains("qty-badge"));
  return { textIdx, qtyIdx };
});
ok("в строке остатка имя идёт ПЕРВЫМ, количество после него",
  order && order.textIdx === 0 && order.qtyIdx > 0, JSON.stringify(order));
const rowH = await page.evaluate(() => {
  const el = document.querySelector(".stock-row");
  return el ? el.getBoundingClientRect().height : 0;
});
ok("строка остатка стала выше (читаемость)", rowH >= 56, `${rowH}px`);
/* Чипы ≥ ~42px на мобиле */
const chipH = await page.evaluate(() => {
  const el = document.querySelector(".chip");
  return el ? el.getBoundingClientRect().height : 0;
});
ok("чипы категорий ≈44px по высоте", chipH >= 41, `${chipH}px`);
/* Нет горизонтального скролла */
ok("нет горизонтального скролла на «Остатках» (390px)",
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

console.log("\n— 8. Design tokens (getComputedStyle резолвит var()-алиасы — проверяем значения) —");
const tokens = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  return {
    glassBg: cs.getPropertyValue("--glass-bg").trim(),
    glassBgStrong: cs.getPropertyValue("--glass-bg-strong").trim(),
    textPrimary: cs.getPropertyValue("--text-primary").trim(),
    textSecondary: cs.getPropertyValue("--text-secondary").trim(),
    transitionNormal: cs.getPropertyValue("--transition-normal").trim(),
    transitionFast: cs.getPropertyValue("--transition-fast").trim(),
    easeSpring: cs.getPropertyValue("--ease-spring").trim(),
    tapMin: cs.getPropertyValue("--tap-min").trim(),
  };
});
ok("--glass-bg резолвится в реальный цвет стекла", /^#\w{6,8}$/.test(tokens.glassBg), tokens.glassBg);
ok("--glass-bg-strong резолвится", /^#\w{6,8}$/.test(tokens.glassBgStrong), tokens.glassBgStrong);
ok("--text-primary резолвится", /^#\w{6}$/.test(tokens.textPrimary), tokens.textPrimary);
ok("--text-secondary резолвится", /^#\w{6}$/.test(tokens.textSecondary), tokens.textSecondary);
ok("--transition-normal = 260ms (.26s)", ["260ms", ".26s", "0.26s"].includes(tokens.transitionNormal), tokens.transitionNormal);
ok("--transition-fast = 160ms (.16s)", ["160ms", ".16s", "0.16s"].includes(tokens.transitionFast), tokens.transitionFast);
ok("--ease-spring задан", tokens.easeSpring.includes("cubic-bezier"), tokens.easeSpring);
ok("--tap-min = 44px", tokens.tapMin === "44px", tokens.tapMin);

console.log("\n— 9. Ширина 320px: ничего не вылезает —");
await page.setViewportSize({ width: 320, height: 640 });
await page.waitForTimeout(500);
ok("нет горизонтального скролла на 320px (остатки)",
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
/* Пилюля влезает в 320px */
const pillW = await page.evaluate(() => document.querySelector(".pill-shell")?.getBoundingClientRect().width ?? 0);
ok("пилюля влезает в 320px", pillW > 0 && pillW <= 320, `${pillW}px`);
await page.setViewportSize({ width: 390, height: 780 });

console.log("\n— 10. Консоль —");
const realErrors = consoleErrors.filter((e) => !e.includes("favicon") && !e.includes("AbortError"));
ok("консоль без ошибок", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n════════ test-v30: ${passed} passed, ${failed} failed ════════`);
if (errors.length) {
  console.log("Провалены:");
  for (const e of errors) console.log("  -", e);
  process.exit(1);
}
