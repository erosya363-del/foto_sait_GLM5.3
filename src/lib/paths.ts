import path from "path";
import {
  PROJECT_ROOT,
  UPLOADS_OPT_DIR,
  UPLOADS_THUMB_DIR,
} from "@/lib/runtime";

/**
 * СТАБИЛИЗАЦИЯ: пути runtime-данных переехали в src/lib/runtime.ts
 * (download/runtime — вне git и вне .next, см. docs/FIX_REPORT.md).
 *
 * Исторический контекст (Шаг 5): standalone-сервер Next.js делает
 * process.chdir(__dirname) → внутри .next/standalone. Все относительные пути
 * (public/…) при записи попадали в КОПИЮ сборки и уничтожались при каждом
 * ребилде. Якорем был DATABASE_URL; теперь якорь — явный projectRoot()
 * из runtime.ts (устойчив к chdir) + env RUNTIME_ROOT/DATABASE_URL/UPLOADS_ROOT.
 *
 * Этот модуль оставлен как единая точка импорта для существующего кода.
 */

export { PROJECT_ROOT, UPLOADS_OPT_DIR, UPLOADS_THUMB_DIR };

/** Публичная статика исходников (public/catalog — сид-фото, это КОД). */
export const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
