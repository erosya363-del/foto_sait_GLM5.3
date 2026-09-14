/**
 * E2E: tick-звук при тапах по нижней пилюле (стаб AudioContext, счётчик тиков).
 * Главный кейс: тап «Каталог» из другого раздела (Остатки/Загрузка/Админ)
 * ДОЛЖЕН звучать так же, как остальные пункты (фикс goCatalog else-ветки).
 * Запуск: node scripts/test-tick-catalog.mjs (сервер на :3000)
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

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

// Стаб AudioContext: считаем созданные осцилляторы = фактически сыгранные тики.
// playTick() создаёт ctx лениво при первом жесте — стаб подменяет класс ДО этого.
await page.evaluate(() => {
  window.__ticks = 0;
  const mkParam = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  class FakeOsc {
    frequency = mkParam();
    connect() {}
    start() {}
    stop() {}
  }
  class FakeGain {
    gain = mkParam();
    connect() {}
  }
  class FakeAC {
    destination = {};
    currentTime = 0;
    state = "running";
    resume() {}
    createOscillator() {
      window.__ticks++;
      return new FakeOsc();
    }
    createGain() {
      return new FakeGain();
    }
  }
  window.AudioContext = FakeAC;
  window.webkitAudioContext = FakeAC;
});

const pillItem = (label) => page.locator(".pill-item", { hasText: label }).first();
const ticks = () => page.evaluate(() => window.__ticks);
const expectTicks = async (name, before) => {
  await page.waitForTimeout(120);
  const now = await ticks();
  ok(name, now === before + 1, `было ${before}, стало ${now}`);
  return now;
};

console.log("── Тик по всем пунктам пилюли ──");
let n = await ticks();

// 1. Каталог → Каталог (повторный тап, уже в каталоге): звук был и раньше
await pillItem("Каталог").click();
n = await expectTicks("повторный тап «Каталог» звучит (как раньше)", n);

// 2. Каталог из «Остатки» — ГЛАВНЫЙ фикс: раньше тика не было
await pillItem("Остатки").click();
n = await expectTicks("«Остатки» звучит", n);
await pillItem("Каталог").click();
n = await expectTicks("тап «Каталог» ИЗ «Остатков» звучит (фикс)", n);

// 3. Каталог из «Загрузка»
await pillItem("Загрузка").click();
n = await expectTicks("«Загрузка» звучит", n);
await pillItem("Каталог").click();
n = await expectTicks("тап «Каталог» ИЗ «Загрузки» звучит (фикс)", n);

// 4. Каталог из «Админ»
await pillItem("Админ").click();
n = await expectTicks("«Админ» звучит", n);
await pillItem("Каталог").click();
n = await expectTicks("тап «Каталог» ИЗ «Админки» звучит (фикс)", n);

// 5. Вид действительно переключился (контроль, что клики реально работают)
const header = await page.locator("header .font-display").first().textContent();
ok("после перехода открыт каталог", /каталог/i.test(header ?? ""), header ?? "");

ok("консоль браузера чистая", consoleErrors.length === 0, consoleErrors.join(" | "));

await browser.close();
console.log(`\nИтог: ${passed} ✓ / ${failed} ✗`);
if (failed > 0) {
  console.log("Провалено:", errors.join(" | "));
  process.exit(1);
}
