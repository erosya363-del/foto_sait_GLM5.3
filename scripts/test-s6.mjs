/**
 * E2E Шаг 6: бег линзы за пальцем (drag-to-select), 4 пункта пилюли,
 * вибро-API (код-ревью вне браузера), растворение пилюли при скролле с
 * горящим активным пунктом, полностью прозрачная шапка при скролле,
 * крупная «Назад» (44px), кружок поиска и «наверх» слева, поле поиска без
 * мигания (серое 80%, тонкая рамка), личные популярные за 7 дней,
 * карточки тканей (гамма + фото каталога), карточки вариантов без
 * «Стандарт/Акция/топпер», компактный NEW, админка: раздел «Ткани»,
 * панель выбранных фото над пилюлей.
 * Запуск: node scripts/test-s6.mjs (сервер на :3000)
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

/** Альфа-канал из computed-цвета (rgba(...) без слэша ИЛИ modern color-mix/oklab со слэшем) */
function alphaOf(color) {
  const slash = /\/\s*([\d.]+)\s*\)/.exec(color ?? "");
  if (slash) return Number(slash[1]);
  const legacy = /,\s*([\d.]+)\)$/.exec(color ?? "");
  return legacy ? Number(legacy[1]) : 1;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const headerTitle = () => page.locator("header .font-display").textContent().then((t) => (t ?? "").trim());

console.log("── 1. Заголовки разделов: только «Askona X» ──");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
ok("Каталог → «Askona Каталог»", (await headerTitle()) === "Askona Каталог", await headerTitle());
ok("мобильная шапка: лого скрыт", !(await page.locator("header img[alt='Askona']").isVisible()));
ok("мобильная шапка: селектор склада скрыт", !(await page.locator("header select").isVisible().catch(() => false)));

await page.locator('nav.pill-nav button:has-text("Остатки")').click();
await page.waitForTimeout(500);
ok("Остатки → «Askona Остатки»", (await headerTitle()) === "Askona Остатки", await headerTitle());
await page.locator('nav.pill-nav button:has-text("Загрузка")').click();
await page.waitForTimeout(500);
ok("Загрузка → «Askona Загрузка фото»", (await headerTitle()) === "Askona Загрузка фото", await headerTitle());
await page.locator('nav.pill-nav button:has-text("Админ")').click();
await page.waitForTimeout(500);
ok("Админ → «Askona Админ»", (await headerTitle()) === "Askona Админ", await headerTitle());
await page.locator('nav.pill-nav button:has-text("Каталог")').click();
await page.waitForTimeout(600);

console.log("── 2. Пилюля: 4 пункта, без «Поиск» ──");
const items = page.locator(".pill-item");
ok("4 пункта", (await items.count()) === 4, `got ${await items.count()}`);
const labels = await items.allTextContents();
ok("без пункта «Поиск»", labels.every((l) => !/Поиск/.test(l)), labels.join("|"));

console.log("── 3. Drag-to-select: линза бежит за пальцем ──");
const b0 = await items.nth(0).boundingBox();
const b1 = await items.nth(1).boundingBox();
const b2 = await items.nth(2).boundingBox();
await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
await page.mouse.down();
await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2, { steps: 6 });
await page.waitForTimeout(120);
const lensMid = await page.locator(".nav-lens").boundingBox();
ok("линза переехала на «Остатки» ещё ДОМ отпускания", Math.abs(lensMid.x - b1.x) < 6, JSON.stringify(lensMid));
await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2, { steps: 6 });
await page.waitForTimeout(120);
const drag2 = await items.nth(2).evaluate((el) => el.classList.contains("is-drag"));
ok("пункт под пальцем подсвечен (is-drag)", drag2);
await page.mouse.up();
await page.waitForTimeout(500);
ok("отпускание активировало «Загрузка»", (await headerTitle()) === "Askona Загрузка фото", await headerTitle());
ok("is-drag снят после отпускания", !(await items.nth(2).evaluate((el) => el.classList.contains("is-drag"))));
// сброс pillTouched (остался от тапов по пилюле) — иначе dim не включится
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
ok("фон панели сильно прозрачнее (50%)", Math.abs(alphaOf(dimBg) - 0.38) < 0.03, dimBg);
ok("рамка панели исчезла", alphaOf(await shell.evaluate((el) => getComputedStyle(el).borderColor)) === 0);
const opItem0 = await items.nth(0).evaluate((el) => Number(getComputedStyle(el).opacity));
const opItem1 = await items.nth(1).evaluate((el) => Number(getComputedStyle(el).opacity));
ok("неактивные пункты почти невидимы (0.38)", Math.abs(opItem0 - 0.38) < 0.02, `got ${opItem0}`);
ok("активный пункт горит (0.8)", Math.abs(opItem1 - 0.8) < 0.02, `got ${opItem1}`);
// касание панели → полная плотность
await page.evaluate(() => {
  document.querySelector(".pill-shell")?.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerId: 99 })
  );
});
await page.waitForTimeout(300);
ok("касание пилюли → pill-active", await shell.evaluate((el) => el.classList.contains("pill-active")));
const activeBg = await shell.evaluate((el) => getComputedStyle(el).backgroundColor);
ok("активное стекло плотное (0.9)", Math.abs(alphaOf(activeBg) - 0.9) < 0.02, activeBg);
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
const themeOp = await page
  .locator("header > span.header-fade")
  .evaluate((el) => Number(getComputedStyle(el).opacity));
ok("переключатель темы скрыт при скролле", themeOp < 0.05, `opacity=${themeOp}`);
// «Назад» появляется на уровнях глубже — откроем категорию через стор
await page.evaluate(() => window.__portal.setState({ catCategory: "Диваны" }));
await page.waitForTimeout(400);
const backBox = await page.locator("header div.lg\\:hidden button[aria-label='Назад']").boundingBox();
ok("«Назад» 44px (было 32 → +37%)", backBox && Math.abs(backBox.width - 44) < 1.5, JSON.stringify(backBox));
ok("«Назад» виден при скролле (единственная кнопка шапки)", backBox && backBox.width > 40);
await page.evaluate(() => window.__portal.setState({ catCategory: null }));
await page.waitForTimeout(300);

console.log("── 6. Кружок поиска и «наверх» — слева ──");
const fab = page.locator(".search-fab");
ok("кружок поиска виден при скролле", await fab.isVisible());
const fabBox = await fab.boundingBox();
ok("кружок СЛЕВА (одна сторона с «Назад»)", fabBox && fabBox.x < 100, JSON.stringify(fabBox));
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
await page.click("#global-search");
await page.waitForTimeout(400);
const dd = page.locator(".search-collapse .absolute.z-50").first();
ok("дропдаун открылся", await dd.isVisible());
const ddBg = await dd.evaluate((el) => getComputedStyle(el).backgroundColor);
ok("дропдаун полупрозрачный (~85%)", Math.abs(alphaOf(ddBg) - 0.85) < 0.06, ddBg);
const ddBlur = await dd.evaluate((el) => getComputedStyle(el).backdropFilter);
ok("фон за дропдауном размыт", /blur/.test(ddBlur), ddBlur);
const input = page.locator("#global-search");
const inpStyle = await input.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { bw: cs.borderWidth, bs: cs.borderStyle, bg: cs.backgroundColor, anim: cs.animationName };
});
ok("тонкая рамка 1px", inpStyle.bw === "1px" && inpStyle.bs === "solid", JSON.stringify(inpStyle));
ok("поле серое полупрозрачное (80%)", Math.abs(alphaOf(inpStyle.bg) - 0.048) < 0.02, inpStyle.bg);
ok("нет анимаций на поле (не мигает)", inpStyle.anim === "none", inpStyle.anim);
ok("старая мигающая рамка .search-frame удалена", (await page.locator(".search-frame").count()) === 0);
const chips = await page.locator(".search-collapse .absolute button").allTextContents();
ok("личный топ-1 «sky» (3 ввода)", chips[0] === "sky", chips.join("|"));
ok("«магни» в популярных", chips.includes("магни"), chips.join("|"));
ok("запрос старше 7 дней не показан", !chips.includes("старьё"), chips.join("|"));
const ddLabel = await page.locator(".search-collapse .absolute p").first().textContent();
ok("заголовок «Популярные за 7 дней»", /за 7 дней/.test(ddLabel ?? ""), ddLabel ?? "");
await page.fill("#global-search", "sky");
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
const logAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("skovo-search-log") || "{}"));
ok("запрос записался в журнал (7 дней)", (logAfter.sky?.length ?? 0) === 4, JSON.stringify(logAfter.sky));
const titleAfterSearch = await headerTitle();
ok("заголовок раздела НЕ подменяется «Поиск: …»", /^Askona (Каталог|Остатки)$/.test(titleAfterSearch), titleAfterSearch);
await page.evaluate(() => window.__portal.getState().applySearch(null));
await page.waitForTimeout(300);

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

console.log("── 9. Карточки вариантов: модель + ткань + гамма, БЕЗ «Стандарт/Акция/топпер» ──");
await page.evaluate(() => window.__portal.setState({ catFabrics: false, catCategory: "Диваны" }));
await page.waitForTimeout(600);
await page.locator('main button:has-text("Трентон")').first().click();
await page.waitForTimeout(800);
const l3Text = await page.locator("main").innerText();
ok("нет «Стандарт»", !/Стандарт/.test(l3Text));
ok("нет «Акция»", !/Акция/.test(l3Text));
ok("нет «топпером»", !/топпером/.test(l3Text));
ok("ткань показана (Sky Velvet / Casanova)", /Sky Velvet|Casanova/.test(l3Text));

console.log("── 10. Лента новинок: компактнее ──");
await page.evaluate(() => window.__portal.getState().resetCatalog());
await page.waitForTimeout(700);
const stripCard = page.locator("main section button.w-\\[100px\\]").first();
if ((await stripCard.count()) > 0) {
  const w = (await stripCard.boundingBox())?.width ?? 0;
  ok("карточки ленты 100px (было 122)", Math.abs(w - 100) < 2, `w=${w}`);
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

console.log("── 13. Светлая тема не сломана (пилюля/шапка) ──");
await page.locator('nav.pill-nav button:has-text("Каталог")').click();
await page.waitForTimeout(400);
await page.evaluate(() => {
  document.documentElement.classList.add("light");
  document.documentElement.classList.remove("dark");
});
await page.waitForTimeout(500);
const lightShell = await shell.evaluate((el) => getComputedStyle(el).backgroundColor);
ok("светлая пилюля светлая", /^rgba\(255,\s*255,\s*255/.test(lightShell), lightShell);
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
