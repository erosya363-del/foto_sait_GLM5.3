import fs from "fs";
import path from "path";

/**
 * СТАБИЛИЗАЦИЯ: единый источник RUNTIME-путей (БД + пользовательские файлы).
 *
 * ПЕРВОПРИЧИНА потери фото (подробно — docs/FIX_REPORT.md):
 *  1) db/custom.db и public/uploads жили в git-трекаемых путях — деплой/откат
 *     песочницы рематериализовал рабочую зону из коммита и затирал runtime;
 *  2) standalone-сервер делает process.chdir(__dirname) → фолбэк
 *     file:<cwd>/db/custom.db создавал БД ВНУТРИ .next/standalone →
 *     каждый rebuild её стирал;
 *  3) всё, что лежало в public/, выпекалось в сборку (cp -r public → standalone).
 *
 * РЕШЕНИЕ: runtime-данные живут в download/runtime (папка download/ —
 * единственная зона, переживающая откат песочницы, и она НЕ в git):
 *
 *   download/runtime/
 *     database/custom.db   ← SQLite (DATABASE_URL)
 *     uploads/optimized/   ← обработанные фото (UPLOADS_ROOT)
 *     uploads/thumbs/      ← миниатюры
 *
 * Переопределяется переменными окружения (для тестов/других сред):
 *   RUNTIME_ROOT   — корень runtime-зоны (высший приоритет)
 *   DATABASE_URL   — прямой URL Prisma (file:…); легаси-значение
 *                    <проект>/db/custom.db ИГНОРИРУЕТСЯ: платформа экспортирует
 *                    его в окружение каждого процесса (проверено по
 *                    /proc/<pid>/environ) — именно этот путь терял данные
 *   UPLOADS_ROOT   — корень пользовательских файлов
 *
 * Bootstrap (ensureRuntime): если файла БД НЕТ — НЕ подменяет данные.
 *   − RUNTIME_ROOT задан явно (изолированная среда тестов) → пустая схема
 *     db/schema-template-empty.db (чистая среда, там нет живых данных);
 *   − RUNTIME_BOOTSTRAP_EMPTY=1 (явный флаг чистой установки) → пустая схема;
 *   − иначе (production) → THROW с инструкцией по восстановлению из бэкапа.
 *
 * ПРАВКА РЕВЬЮ v2: прежний фолбэк «нет runtime → взять db/custom.db» умел
 * молча вернуть СТАРЫЙ набор фото после пропажи/повреждения runtime-зоны —
 * тот самый симптом, от которого лечимся. Теперь production без БД падает
 * ГРОМКО, данные не подменяются (восстановление — restore-runtime.sh).
 */

/** Корень ПРОЕКТА (не меняется chdir'ом standalone-сервера). */
export function projectRoot(): string {
  const cwd = process.cwd();
  // standalone: server.js делает chdir в .next/standalone
  if (
    path.basename(cwd) === "standalone" &&
    path.basename(path.dirname(cwd)) === ".next"
  ) {
    return path.resolve(cwd, "..", "..");
  }
  return cwd;
}

export const PROJECT_ROOT = projectRoot();

/** Корень runtime-зоны (БД + загрузки). Никогда не внутри .next и не в git. */
export const RUNTIME_ROOT =
  process.env.RUNTIME_ROOT || path.join(PROJECT_ROOT, "download", "runtime");

/** Корень пользовательских файлов (optimized/thumbs). */
export const UPLOADS_ROOT =
  process.env.UPLOADS_ROOT || path.join(RUNTIME_ROOT, "uploads");

export const UPLOADS_OPT_DIR = path.join(UPLOADS_ROOT, "optimized");
export const UPLOADS_THUMB_DIR = path.join(UPLOADS_ROOT, "thumbs");
export const RUNTIME_DB_DIR = path.join(RUNTIME_ROOT, "database");

/**
 * Файл БД. Приоритет:
 *  1. env RUNTIME_ROOT (тесты/изолированные среды) → <RUNTIME_ROOT>/database/custom.db
 *  2. env DATABASE_URL (file:…, абсолютный) — КРОМЕ легаси-значения
 *     <проект>/db/custom.db: платформа экспортирует его в окружение КАЖДОГО
 *     процесса (проверено /proc/<pid>/environ) и именно этот путь был причиной
 *     потери данных — такое значение игнорируется и уходит в bootstrap
 *  3. По умолчанию — защищённая runtime-зона download/runtime
 */
export function databaseFile(): string {
  const runtimeRoot = process.env.RUNTIME_ROOT;
  if (runtimeRoot) return path.join(runtimeRoot, "database", "custom.db");

  const legacyDb = path.join(PROJECT_ROOT, "db", "custom.db");
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith("file:")) {
    const p = url.slice("file:".length);
    if (path.isAbsolute(p) && p !== legacyDb) return p;
  }
  return path.join(RUNTIME_DB_DIR, "custom.db");
}

export const DATABASE_FILE = databaseFile();
export const DATABASE_URL = `file:${DATABASE_FILE}`;

/** Публичная статика исходников (сид-фото public/catalog и пр.) — это КОД, не runtime. */
export const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");

let bootstrapDone = false;

/**
 * Гарантирует наличие БД и runtime-каталогов. Вызывается один раз при старте
 * процесса (из src/lib/db.ts ДО первого запроса). Только КОПИРОВАНИЕ
 * отсутствующих файлов — никаких reset/seed/перезаписей.
 *
 * FAIL-LOUDLY: в production отсутствие runtime-БД — ошибка, а не повод
 * подменять данные легаси-копией или пустой схемой.
 */
export function ensureRuntime(): void {
  if (bootstrapDone) return;
  bootstrapDone = true;

  try {
    fs.mkdirSync(RUNTIME_DB_DIR, { recursive: true });
    fs.mkdirSync(UPLOADS_OPT_DIR, { recursive: true });
    fs.mkdirSync(UPLOADS_THUMB_DIR, { recursive: true });
  } catch {
    /* повтор на первом запросе невозможен — но падать тут не надо:
       Prisma сама сообщит о недоступной БД */
  }

  if (fs.existsSync(DATABASE_FILE)) return;

  // Пустая схема (0 строк, только таблицы) — ТОЛЬКО для заведомо пустых сред
  const template = path.join(PROJECT_ROOT, "db", "schema-template-empty.db");
  const isolatedEnv = Boolean(process.env.RUNTIME_ROOT); // изолированная среда тестов
  const explicitFreshInstall = process.env.RUNTIME_BOOTSTRAP_EMPTY === "1";

  if (!isolatedEnv && !explicitFreshInstall) {
    // ПРОДАКШЕН: данных нет и подменять их нечем/нельзя — падаем громко.
    throw new Error(
      "[runtime] Runtime-БД отсутствует: " +
        DATABASE_FILE +
        "\n" +
        "  Данные НЕ подменяются (legacy/пустая схема запрещены в production).\n" +
        "  Восстановление из бэкапа: bash scripts/restore-runtime.sh <архив.tar.gz>\n" +
        "  Список бэкапов: ls -1t download/backups/runtime-*.tar.gz\n" +
        "  ТОЛЬКО для заведомо чистой установки (без данных):\n" +
        "    RUNTIME_BOOTSTRAP_EMPTY=1 — разрешит пустую схему без записей"
    );
  }

  if (!fs.existsSync(template)) {
    throw new Error(
      "[runtime] Нет ни БД, ни шаблона пустой схемы: " + template
    );
  }

  try {
    fs.copyFileSync(template, DATABASE_FILE);
    console.log(
      isolatedEnv
        ? `[runtime] изолированная среда: БД создана из пустой схемы (RUNTIME_ROOT=${RUNTIME_ROOT})`
        : "[runtime] RUNTIME_BOOTSTRAP_EMPTY=1: БД создана из ПУСТОЙ схемы (без записей)"
    );
  } catch (e) {
    throw new Error(
      `[runtime] Не удалось создать БД из шаблона ${template}: ${String(e)}`
    );
  }
}
