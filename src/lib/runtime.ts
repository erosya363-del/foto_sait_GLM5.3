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
 * Bootstrap (ensureRuntime): если файла БД НЕТ, он создаётся ОДИН РАЗ
 * копированием из:
 *   1. db/custom.db            (легаси-путь — живые данные старой установки)
 *   2. db/schema-template-empty.db (пустая схема — чистый деплой)
 * НИКОГДА не перезаписывает существующую БД и не выполняет seed/reset.
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

  // 1) легаси-БД старой установки (живые данные важнее пустой схемы)
  const legacy = path.join(PROJECT_ROOT, "db", "custom.db");
  // 2) пустая схема для чистого деплоя (0 строк, только таблицы)
  const template = path.join(PROJECT_ROOT, "db", "schema-template-empty.db");

  const source = fs.existsSync(legacy) ? legacy : fs.existsSync(template) ? template : null;
  if (!source) return; // Prisma создаст пустой файл — таблиц нет, но это честное состояние

  try {
    fs.copyFileSync(source, DATABASE_FILE);
    for (const suffix of ["-wal", "-shm"]) {
      const srcSide = source + suffix;
      if (source === legacy && fs.existsSync(srcSide)) {
        try {
          fs.copyFileSync(srcSide, DATABASE_FILE + suffix);
        } catch {
          /* сайд-файл не критичен */
        }
      }
    }
    console.log(
      `[runtime] БД не найдена — выполнен bootstrap-копированием из ${path.relative(PROJECT_ROOT, source)}`
    );
  } catch {
    /* не смогли скопировать — Prisma отработает как сможет, но процесс не падает */
  }
}
