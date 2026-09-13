import path from "path";

/**
 * Шаг 5, критический фикс:
 * standalone-сервер Next.js делает process.chdir(__dirname) → внутри
 * .next/standalone. Все относительные пути (public/…) при записи попадали
 * в КОПИЮ сборки и уничтожались при каждом ребилде, а статика кэширует
 * список файлов на старте — свежие загрузки не отдавались без рестарта.
 *
 * Решение: единственный надёжный якорь корня проекта — DATABASE_URL
 * (file:/<проект>/db/custom.db), он одинаково доступен в dev и standalone.
 */

export function projectRoot(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (url.startsWith("file:")) {
    const dbFile = url.slice("file:".length);
    if (path.isAbsolute(dbFile)) return path.dirname(path.dirname(dbFile));
  }
  return process.cwd();
}

export const PUBLIC_DIR = path.join(projectRoot(), "public");
export const UPLOADS_OPT_DIR = path.join(PUBLIC_DIR, "uploads", "optimized");
export const UPLOADS_THUMB_DIR = path.join(PUBLIC_DIR, "uploads", "thumbs");
