/**
 * FAIL-CLOSED GUARD для МУТИРУЮЩИХ E2E (правка ревью, приоритет P1).
 *
 * Проблема, которую закрывает:
 *   скрипты с фолбэком `E2E_BASE || "http://localhost:3000"` при запуске
 *   «напрямую» (bun scripts/test-s5.mjs) молча уходили в PRODUCTION-сервер
 *   :3000 и PRODUCTION runtime-зону — мутировали реальные данные.
 *
 * Правило: мутирующий тест запускается ТОЛЬКО при явно переданном
 * E2E_BASE (изоляция: bash scripts/run-isolated.sh поднимает копию на :3100).
 * Дополнительно жёстко запрещён явный :3000 — даже если его кто-то передал.
 *
 * Использование (side-effect import в начале теста):
 *   import "./e2e-guard.mjs";              // требует только E2E_BASE
 *   import "./e2e-guard.mjs";               // + в тесте: E2E_RUNTIME проверяется отдельно
 *
 * Ожидаемое поведение без изоляции:
 *   ✗ REFUSE TO RUN …   и process.exit(1) — НЕ переходить на production.
 */

const BASE = process.env.E2E_BASE || "";
const PROD_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):3000/;

function refuse(reason) {
  console.error("✗ REFUSE TO RUN: мутирующий E2E без изолированной среды.");
  console.error(`  Причина: ${reason}`);
  console.error("");
  console.error("  Правильный запуск (копия production-данных, сервер :3100):");
  console.error("    bash scripts/run-isolated.sh bun scripts/<тест>.mjs");
  console.error("");
  console.error("  Изолированная среда сама передаёт E2E_BASE/E2E_RUNTIME/E2E_ROOT;");
  console.error("  после теста копия данных уничтожается, production не тронут.");
  process.exit(1);
}

if (!BASE) {
  refuse(
    "E2E_BASE не задан — фолбэк на production :3000 запрещён (fail-closed)"
  );
}

if (PROD_RE.test(BASE)) {
  refuse(
    `E2E_BASE указывает на production (${BASE}) — мутирующие тесты на нём запрещены`
  );
}

console.log(`── e2e-guard: изоляция подтверждена (E2E_BASE=${BASE})`);
