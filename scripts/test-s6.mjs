/**
 * E2E Шаг 6 (v2.8): пилюля БЕЗ линзы/драга (п.5: стабильна), 4 пункта,
 * растворение при скролле, шапка-вкладка (п.8), поиск без autofocus (п.9),
 * карточки тканей, админка: Ткани/Справочники без дублей (п.3),
 * фотобанк с редактором привязки (п.4) и панелью над пилюлей.
 * МУТИРУЮЩИЙ ТЕСТ (админка/фотобанк) — только через изоляцию (fail-closed):
 *   bash scripts/run-isolated.sh bun scripts/test-s6.mjs
 */
import "./e2e-guard.mjs";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE;
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

/** Альфа-канал из computed-цвета (rgba(...) без слэша ИЛИ modern color-mix/oklab со слэшем) */
function alphaOf(color) {
  const slash = /\/\s*([\d.]+)\s*\)/.exec(color ?? "");
  if (slash) return Number(slash[1]);
  const legacy = /,\s*([\d.]+)\)$/.exec(color ?? "");
  return legacy ? Number(legacy[1]) : 1;
}

/** Дождаться завершения CSS-перехода: опрашиваем значение до 2.5с (флаки под нагрузкой) */
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

const headerTitle = () => page.locator("header .font-display").textContent().then((t) => (t ?? "").trim());

console.log("── 1. Заголовки разделов: только вкладка (п.8 ТЗ) ──");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
ok("Каталог → «Каталог»", (await headerTitle()) === "Каталог", await headerTitle());
ok("мобильная шапка: лого скрыт", !(await page.locator("header img[alt='Askona']").isVisible()));
ok("мобильная шапка: селектора склада нет вовсе (п.7)", (await page.locator("header select").count()) === 0);

await page.locator('nav.pill-nav button:has-text("Остатки")').click();
await page.waitForTimeout(500);
ok("Остатки → «Остатки»", (await headerTitle()) === "Остатки", await headerTitle());
await page.locator('nav.pill-nav button:has-text("Загрузка")').click();
await page.waitForTimeout(500);
ok("Загрузка → «Загрузка»", (await headerTitle()) === "Загрузка", await headerTitle());
await page.locator('nav.pill-nav button:has-text("Админ")').click();
await page.waitForTimeout(500);
ok("Админ → «Админ»", (await headerTitle()) === "Админ", await headerTitle());
await page.locator('nav.pill-nav button:has-text("Каталог")').click();
await page.waitForTimeout(600);

console.log("── 2. Пилюля: 4 пункта, без «Поиск» ──");
const items = page.locator(".pill-item");
ok("4 пункта", (await items.count()) === 4, `got ${await items.count()}`);
const labels = await items.allTextContents();
ok("без пункта «Поиск»", labels.every((l) => !/Поиск/.test(l)), labels.join("|"));

console.log("── 3. Drag по пилюле БОЛЬШЕ ничего не двигает/не активирует (п.5 ТЗ) ──");
const b0 = await items.nth(0).boundingBox();
const b1 = await items.nth(1).boundingBox();
const b2 = await items.nth(2).boundingBox();
const itemsBefore = await page.evaluate(() =>
  [...document.querySelectorAll(".pill-item")].map((el) => el.getBoundingClientRect().x)
);
await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
await page.mouse.down();
await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2, { steps: 6 });
await page.waitForTimeout(160);
ok("линзы нет в DOM во время пальца", (await page.locator(".nav-lens").count()) === 0);
ok("нет is-drag подсветки под пальцем", !(await items.nth(1).evaluate((el) => el.classList.contains("is-drag"))));
const scale1 = await items.nth(1).evaluate((el) => {
  const m = getComputedStyle(el.querySelector("svg")).transform;
  return m && m !== "none" ? parseFloat(m.slice(7)) : 1;
});
ok("иконка под пальцем НЕ увеличивается (магнит удалён)", Math.abs(scale1 - 1) < 0.03, `scale=${scale1}`);
await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2, { steps: 6 });
await page.waitForTimeout(160);
await page.mouse.up();
await page.waitForTimeout(600);
ok("отпускание пальца НЕ активировало раздел (активация — только тап)", (await headerTitle()) === "Каталог", await headerTitle());
ok("is-drag не появился после отпускания", !(await items.nth(2).evaluate((el) => el.classList.contains("is-drag"))));
const itemsAfter = await page.evaluate(() =>
  [...document.querySelectorAll(".pill-item")].map((el) => el.getBoundingClientRect().x)
);
ok("иконки не сдвинулись за время жеста", itemsBefore.every((x, i) => Math.abs(x - itemsAfter[i]) < 0.5));
// сброс pillTouched (остался от касания пилюли) — иначе dim не включится
await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerdown")));
await page.waitForTimeout(250);

console.log("── 4. Растворение пилюли при скролле: панель призрачна, активный горит ──");
// L1 почти не скроллится (лента новинок пуста) — скроллим «Остатки» (длинный список)
await page.locator('nav.pill-nav button:has-text("Остатки")').click();
await page.waitForTimeout(700);
// клик по пилюле снова включил pillTouched — снимаем и скроллим
await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerdown")));
await page.waitForTimeout(250);
await page.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
await page.waitForTimeout(450);
const shell = page.locator(".pill-shell");
ok("pill-dim включён", await shell.evaluate((el) => el.classList.contains("pill-dim")));
const dimBg = await shell.evaluate((el) => getComputedStyle(el).backgroundColor);
ok("фон панели сильно прозрачнее при скролле (dim 0.14)", Math.abs(alphaOf(dimBg) - 0.14) < 0.03, dimBg);
/* рамка растворяется transition'ом 0.28s — под нагрузкой 450мс не всегда хватает */
let borderGone = true;
try {
  await page.waitForFunction(
    () => {
      const el = document.querySelector(".pill-shell");
      if (!el) return false;
      const c = getComputedStyle(el).borderTopColor;
      const m = /rgba?\(([^)]+)\)/.exec(c);
      const a = m ? parseFloat(m[1].split(",")[3] ?? "1") : 1;
      return a === 0;
    },
    { timeout: 2000 }
  );
} catch {
  borderGone = false;
}
ok("рамка панели исчезла", borderGone);
const opItem0 = await items.nth(0).evaluate((el) => Number(getComputedStyle(el).opacity));
const opItem1 = await items.nth(1).evaluate((el) => Number(getComputedStyle(el).opacity));
ok("неактивные пункты чёткие (opacity 1, текст без прозрачности)", Math.abs(opItem0 - 1) < 0.02, `got ${opItem0}`);
ok("активный пункт чёткий (opacity 1, текст без прозрачности)", Math.abs(opItem1 - 1) < 0.02, `got ${opItem1}`);
// касание панели → полная плотность
await page.evaluate(() => {
  document.querySelector(".pill-shell")?.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerId: 99 })
  );
});
await page.waitForTimeout(300);
ok("касание пилюли → pill-active", await shell.evaluate((el) => el.classList.contains("pill-active")));
/* Переход фона 0.38→0.9 анимируется: под нагрузкой (после других наборов)
   300мс хватает не всегда — ждём settle до 2с, потом читаем. */
let activeSettled = true;
try {
  await page.waitForFunction(
    () => {
      const el = document.querySelector(".pill-shell");
      if (!el) return false;
      const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
      const a = m ? parseFloat(m[1].split(",")[3] ?? "1") : 1;
      return a >= 0.58;
    },
    { timeout: 2000 }
  );
} catch {
  activeSettled = false;
}
const activeBg = await shell.evaluate((el) => getComputedStyle(el).backgroundColor);
ok("активное стекло плотное (0.62)", activeSettled && Math.abs(alphaOf(activeBg) - 0.62) < 0.04, activeBg);
await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerdown")));
await page.waitForTimeout(250);
ok("тап мимо → pill-active снялся", !(await shell.evaluate((el) => el.classList.contains("pill-active"))));

console.log("── 5. Шапка при скролле: полностью прозрачна, «Назад» крупная ──");
const hdrBg = await page.locator("header.glass").evaluate((el) => getComputedStyle(el).backgroundColor);
ok("фон шапки прозрачный", hdrBg === "rgba(0, 0, 0, 0)", hdrBg);
const hdrBlur = await page.locator("header.glass").evaluate((el) => getComputedStyle(el).backdropFilter);
ok("блюр шапки снят", hdrBlur === "none", hdrBlur);
const titleOp = await page
  .locator("header .font-display")
  .evaluate((el) => Number(getComputedStyle(el.closest(".header-fade") ?? el).opacity));
ok("заголовок скрыт при скролле", titleOp < 0.05, `opacity=${titleOp}`);
const themeSw = page.locator("header [role='radiogroup']");
const themeOp = await themeSw.evaluate((el) => Number(getComputedStyle(el).opacity));
ok(
  "переключатель темы ВИДЕН при скролле (фикс «пропадает тема»)",
  (await themeSw.isVisible()) && Math.abs(themeOp - 1) < 0.02,
  `opacity=${themeOp}`
);
// «Назад» появляется на уровнях глубже — откроем категорию через стор
await page.evaluate(() => window.__portal.setState({ catCategory: "Диваны" }));
await page.waitForTimeout(400);
const backBox = await page.locator("header div.lg\\:hidden button[aria-label='Назад']").boundingBox();
ok("«Назад» 44px (было 32 → +37%)", backBox && Math.abs(backBox.width - 44) < 1.5, JSON.stringify(backBox));
ok("«Назад» виден при скролле (единственная кнопка шапки)", backBox && backBox.width > 40);
await page.evaluate(() => window.__portal.setState({ catCategory: null }));
await page.waitForTimeout(300);

console.log("── 6. Поиск переехал в пилюлю; «наверх» — слева ──");
const pillSearch = page.locator(".pill-search");
ok("круглый поиск на пилюле виден при скролле (вместо кружка)", await pillSearch.isVisible());
const psBox = await pillSearch.boundingBox();
ok("круглый поиск СПРАВА (в панели)", psBox && psBox.x > 200, JSON.stringify(psBox));
const ftop = page.locator(".fab-top");
ok("стрелка «наверх» видна", await ftop.isVisible());
const ftopBox = await ftop.boundingBox();
ok("стрелка «наверх» СЛЕВА", ftopBox && ftopBox.x < 100, JSON.stringify(ftopBox));
await page.screenshot({ path: "tool-results/s6-scrolled.png" });

console.log("── 7. Поиск: поле без мигания + личные популярные за 7 дней ──");
await page.evaluate(() => {
  const now = Date.now();
  localStorage.setItem(
    "skovo-search-log",
    JSON.stringify({
      sky: [now - 3600e3, now - 7200e3, now - 3 * 86400e3],
      магни: [now - 86400e3],
      старьё: [now - 10 * 86400e3],
    })
  );
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
/* Поиск открыт из круглой кнопки на пилюле (шаг 3) — поле теперь одно,
   в подвесной карточке над панелью */
await page.evaluate(() => document.querySelector(".pill-search")?.click());
await page.waitForTimeout(400);
const dd = page.locator(".search-pop .search-dd").first();
/* П.9 ТЗ: при открытии карточки поле БЕЗ фокуса — дропдауна ещё НЕТ,
   клавиатура не вскакивает; дропдаун появится после тапа по полю */
ok("при открытии дропдауна нет (поле не в фокусе)", !(await dd.isVisible().catch(() => false)));
await page.waitForTimeout(400);
/* Фокус-жалоба v2.9: снимаем БАЗОВЫЙ стиль поля (карточка открыта, фокуса НЕТ) —
   после тапа сравним: при фокусе НИЧЕГО не должно меняться */
const baseInp = await page
  .locator("input[data-search-input]")
  .first()
  .evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, bc: cs.borderColor, br: cs.borderRadius, ol: cs.outlineStyle, h: cs.height, w: cs.width };
  });
await page.locator("input[data-search-input]").first().click();
await page.waitForTimeout(400);
ok("дропдаун открылся после тапа по полю", await dd.isVisible());
const ddBg = await dd.evaluate((el) => getComputedStyle(el).backgroundColor);
ok("дропдаун полупрозрачный (~85%)", Math.abs(alphaOf(ddBg) - 0.85) < 0.06, ddBg);
const ddBlur = await dd.evaluate((el) => getComputedStyle(el).backdropFilter);
ok("фон за дропдауном размыт", /blur/.test(ddBlur), ddBlur);
const input = page.locator("input[data-search-input]").first(); // поле одно — в карточке над панелью
const inpStyle = await input.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { bw: cs.borderWidth, bs: cs.borderStyle, bg: cs.backgroundColor, bc: cs.borderColor, br: cs.borderRadius, ol: cs.outlineStyle, h: cs.height, w: cs.width, anim: cs.animationName };
});
ok("тонкая рамка 1px", inpStyle.bw === "1px" && inpStyle.bs === "solid", JSON.stringify(inpStyle));
/* ФОКУС = НОЛЬ ИЗМЕНЕНИЙ (прямая просьба владельца v2.9): тот же фон, кромка,
   форма (radius), никакой обводки — единственный признак фокуса — курсор */
ok("поле при фокусе НЕ меняет фон/кромку/форму", inpStyle.bg === baseInp.bg && inpStyle.bc === baseInp.bc && inpStyle.br === baseInp.br, JSON.stringify({ base: baseInp, focused: inpStyle }));
ok("нет обводки при фокусе (outline none — бирюза убрана)", inpStyle.ol === "none", inpStyle.ol);
ok("геометрия поля стабильна при фокусе", inpStyle.h === baseInp.h && inpStyle.w === baseInp.w, JSON.stringify({ base: `${baseInp.h}×${baseInp.w}`, focused: `${inpStyle.h}×${inpStyle.w}` }));
ok("нет анимаций на поле (не мигает)", inpStyle.anim === "none", inpStyle.anim);
ok("старая мигающая рамка .search-frame удалена", (await page.locator(".search-frame").count()) === 0);
const chips = await page.locator(".search-pop .search-dd button").allTextContents();
ok("личный топ-1 «sky» (3 ввода)", chips[0] === "sky", chips.join("|"));
ok("«магни» в популярных", chips.includes("магни"), chips.join("|"));
ok("запрос старше 7 дней не показан", !chips.includes("старьё"), chips.join("|"));
const ddLabel = await page.locator(".search-pop .search-dd p").first().textContent();
ok("заголовок «Последние запросы» (популярное удалено — аудит v2.6)", /Последние запросы/.test(ddLabel ?? ""), ddLabel ?? "");
ok("показано не более 4 последних (ограничение владельца)", chips.length <= 4, chips.join("|"));
await page.fill("input[data-search-input]", "sky");
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
const logAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("skovo-search-log") || "{}"));
ok("запрос записался в журнал (7 дней)", (logAfter.sky?.length ?? 0) === 4, JSON.stringify(logAfter.sky));
const titleAfterSearch = await headerTitle();
ok("заголовок раздела НЕ подменяется «Поиск: …»", /^(Каталог|Остатки)$/.test(titleAfterSearch), titleAfterSearch);
await page.evaluate(() => window.__portal.getState().applySearch(null));
await page.waitForTimeout(300);
/* v3.1: search mode прячет панель — закрываем карточку (крестик) перед тапом по пилюле */
await page.evaluate(() => document.querySelector(".search-pop-close")?.click());
await page.waitForTimeout(350);

console.log("── 8. Карточки тканей: гамма + фото каталога, без счётчиков ──");
await page.locator('nav.pill-nav button:has-text("Каталог")').click();
await page.waitForTimeout(500);
await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerdown")));
await page.evaluate(() => window.__portal.getState().setCatFabrics(true));
await page.waitForTimeout(700);
const fabricsMain = await page.locator("main").innerText();
ok("нет «вариантов фото» на карточках", !/вариантов фото/.test(fabricsMain), fabricsMain.slice(0, 120));
ok("ткани показаны (Sky Velvet)", /Sky Velvet/.test(fabricsMain));
const fabApi = await (await fetch(BASE + "/api/catalog?level=fabrics")).json();
ok("API тканей: поле colorGroup есть", "colorGroup" in (fabApi.fabrics?.[0] ?? {}));
ok("API тканей: thumb = свежее фото (есть у тканей с вариантами)", fabApi.fabrics.every((f) => typeof f.thumb === "string" || f.thumb === null));
const newBadges = page.locator("main span:has-text('NEW')");
const badgeCount = await newBadges.count();
if (badgeCount > 0) {
  const fs = await newBadges.first().evaluate((el) => getComputedStyle(el).fontSize);
  ok("NEW бейдж уменьшен (8px)", fs === "8px", fs);
} else {
  console.log("  ~ NEW-бейджей в данных нет — проверка размера пропущена");
}
await page.screenshot({ path: "tool-results/s6-fabrics.png" });

console.log("── 9. Карточки вариантов: без «Стандарт/Акция/топпер» ──");
await page.evaluate(() => window.__portal.setState({ catFabrics: false, catCategory: "Диваны" }));
await page.waitForTimeout(600);
/* модели без фото скрыты — первая видимая строка модели */
await page.locator('main button:has-text("вариантов фото")').first().click();
await page.waitForTimeout(800);
const l3Text = await page.locator("main").innerText();
ok("нет «Стандарт»", !/Стандарт/.test(l3Text));
ok("нет «Акция»", !/Акция/.test(l3Text));
ok("нет «топпером»", !/топпером/.test(l3Text));
ok("карточки вариантов отрисованы", (await page.locator("main button:has(img)").count()) > 0);

console.log("── 10. Лента новинок: компактнее ──");
await page.evaluate(() => window.__portal.getState().resetCatalog());
await page.waitForTimeout(700);
const stripCard = page.locator("main section button.w-\\[92px\\]").first();
if ((await stripCard.count()) > 0) {
  const w = (await stripCard.boundingBox())?.width ?? 0;
  ok("карточки ленты 92px (компактнее по высоте, шаг 1)", Math.abs(w - 92) < 2, `w=${w}`);
} else {
  console.log("  ~ лента новинок пуста — пропуск");
}

console.log("── 11. Админка: раздел «Ткани» + API ──");
await page.locator('nav.pill-nav button:has-text("Админ")').click();
await page.waitForTimeout(600);
await page.locator('button[role="tab"]:has-text("Ткани")').click();
await page.waitForTimeout(500);
ok("форма «Новая ткань» видна", (await page.locator("main input[placeholder*='Название ткани']").count()) === 1);
ok("кнопка «Создать ткань»", (await page.locator("main button:has-text('Создать ткань')").count()) === 1);
const fabricRows = await page.locator("main").innerText();
ok("список тканей в разделе", /Sky Velvet/.test(fabricRows));

// API: создание ткани с гаммой
const created = await fetch(BASE + "/api/admin", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ entity: "material", action: "create", name: "ТестТкань-s6", type: "Ткань", colorGroup: "Тест-гамма" }),
});
const createdJson = await created.json();
ok("API: ткань создана", created.ok, JSON.stringify(createdJson));
const tid = createdJson.id;
// API: смена гаммы
const gr = await fetch(BASE + "/api/admin", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "setFabricGroup", id: tid, colorGroup: "Серая" }),
});
ok("API: гамма обновлена", gr.ok);
const dict = await (await fetch(BASE + "/api/dictionaries")).json();
const tf = dict.materials.find((m) => m.name === "ТестТкань-s6");
ok("API: dictionaries отдаёт colorGroup", tf?.colorGroup === "Серая", JSON.stringify(tf));
// API: fabric-photo валидация
const fp = await fetch(BASE + "/api/fabric-photo", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ materialId: tid }),
});
ok("API: fabric-photo без файла → 400", fp.status === 400, `got ${fp.status}`);
// API: удаление
const del = await fetch(BASE + "/api/admin", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ entity: "material", action: "delete", id: tid }),
});
ok("API: тестовая ткань удалена (чистка)", del.ok);

console.log("── 11b. Справочники: только системные, без дублей (п.3 ТЗ) ──");
await page.locator('button[role="tab"]:has-text("Справочники")').click();
await page.waitForTimeout(400);
const dictTabs = await page.locator('main [role="tablist"] button').allTextContents();
ok("в справочниках Категории/Размеры/Признаки", /Категории/.test(dictTabs.join("|")) && /Размеры/.test(dictTabs.join("|")) && /Признаки/.test(dictTabs.join("|")), dictTabs.join("|"));
ok("нет дубля «Модели» (модели живут в Товарах)", !dictTabs.includes("Модели"), dictTabs.join("|"));
ok("нет дубля «Материалы» (ткани живут в Тканях)", !dictTabs.includes("Материалы"), dictTabs.join("|"));

console.log("── 12. Админка: панель выбранных фото НАД пилюлей ──");
await page.locator('button[role="tab"]:has-text("Фото")').click();
await page.waitForTimeout(900);
const photoBtn = page.locator("main button[aria-pressed]").first();
if ((await photoBtn.count()) > 0) {
  await photoBtn.click();
  await page.waitForTimeout(400);
  const bar = page.locator("main .sticky:has-text('Выбрано')");
  ok("панель выбора видна", await bar.isVisible());
  const barBox = await bar.boundingBox();
  ok("панель выше пилюли (низ ≤ 760-86)", barBox && barBox.y + barBox.height <= 760 - 86 + 2, JSON.stringify(barBox));
  ok("кнопка «Снять» на панели", (await bar.locator("button:has-text('Снять')").count()) === 1);
  ok("кнопка «В корзину» на панели", (await bar.locator("button:has-text('В корзину')").count()) === 1);
  await page.screenshot({ path: "tool-results/s6-admin-photoselect.png" });
  await bar.locator("button:has-text('Снять')").click();
  await page.waitForTimeout(300);
  ok("«Снять» сбрасывает выбор", (await page.locator("main .sticky:has-text('Выбрано')").count()) === 0);
} else {
  console.log("  ~ фото в фотобанке отсутствуют — пропуск");
}

console.log("── 12b. Редактирование привязки фото (п.4 ТЗ) ──");
const photoApi = await (await fetch(BASE + "/api/admin?view=photos")).json();
ok("API view=photos: привязка полная", photoApi.items.every((p) => "categoryId" in p && "modelId" in p && "variantPhotoCount" in p));
if (photoApi.items.length >= 1) {
  const somePhoto = photoApi.items[0];
  await page.locator('main button[aria-label="Редактировать привязку фото"]').first().click();
  await page.waitForTimeout(500);
  ok("диалог редактирования привязки открыт", await page.locator("[data-slot='dialog-content']").isVisible());
  ok("кнопка «Удалить фото» в диалоге (п.4)", (await page.locator("[data-slot='dialog-content'] button:has-text('Удалить фото')").count()) === 1);
  const dlgBox = await page.locator("[data-slot='dialog-content']").boundingBox();
  ok("диалог целиком в viewport (п.1: не уходит за экран)", dlgBox && dlgBox.y >= 0 && dlgBox.y + dlgBox.height <= 761, JSON.stringify(dlgBox));
  await page.locator("[data-slot='dialog-content'] button:has-text('Отмена')").click();
  await page.waitForTimeout(300);
  // API: неполные данные → отказ
  const bad = await fetch(BASE + "/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "movePhoto", id: somePhoto.id }),
  });
  ok("API: movePhoto без категории → 400", bad.status === 400, `got ${bad.status}`);
  // API: та же связка → ok, переноса нет
  const same = await fetch(BASE + "/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "movePhoto", id: somePhoto.id,
      categoryId: somePhoto.categoryId, modelId: somePhoto.modelId,
      materialId: somePhoto.materialId ?? "", sizeId: somePhoto.sizeId ?? "",
      variantName: somePhoto.variantName ?? "",
    }),
  });
  const sameJson = await same.json();
  ok("API: movePhoto в ту же связку → ok без переноса", same.ok && sameJson.moved === false, JSON.stringify(sameJson));
} else {
  console.log("  ~ фото отсутствуют — пропуск 12b");
}

console.log("── 13. Светлая тема не сломана (пилюля/шапка) ──");
await page.locator('nav.pill-nav button:has-text("Каталог")').click();
await page.waitForTimeout(400);
await page.evaluate(() => {
  document.documentElement.classList.add("light");
  document.documentElement.classList.remove("dark");
});
await page.waitForTimeout(500);
// снять pill-active (тап по пилюле выше) — читаем БАЗОВОЕ стекло светлой темы
await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerdown")));
/* переход фона темы 280мс: читаем с settle (полноцветный кадр 149/159/168 · 0.353
   пойман однажды — это середина перехода, ждём целевое значение) */
const lightShell = await settle(
  () => shell.evaluate((el) => getComputedStyle(el).backgroundColor),
  (v) => /^rgba\(255,\s*255,\s*255/.test(v)
);
ok(
  "светлая пилюля — белое translucent стекло v4 (палитра «Изумруд»)",
  /^rgba\(255,\s*255,\s*255/.test(lightShell),
  lightShell
);
await page.evaluate(() => {
  document.documentElement.classList.add("dark");
  document.documentElement.classList.remove("light");
});
await page.waitForTimeout(250);

console.log("── 14. Консоль ──");
const realErrors = consoleErrors.filter((e) => !/Download the React DevTools/i.test(e));
ok("консоль чистая", realErrors.length === 0, JSON.stringify(realErrors).slice(0, 300));

console.log(`\n═══ ИТОГ: ${passed} ✓ / ${failed} ✗ ═══`);
if (failed) {
  console.log("Провалены:", errors.join(" | "));
  process.exit(1);
}
await browser.close();
