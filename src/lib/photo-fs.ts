import path from "path";
import { existsSync } from "fs";
import { unlink } from "fs/promises";
import { PUBLIC_DIR, UPLOADS_OPT_DIR, UPLOADS_THUMB_DIR } from "@/lib/paths";

/**
 * Шаг 5: физическое удаление файлов фото с диска.
 *
 * Правила безопасности:
 *  1. Удаляем ТОЛЬКО файлы из public/uploads/optimized и public/uploads/thumbs
 *     (загруженные пользователями). Сид-фото (файл с тем же именем лежит в
 *     public/catalog/) на диске НЕ трогаем — они общие и используются
 *     несколькими вариантами. АУДИТ v2.7: раньше защита держалась на префиксе
 *     «/catalog/» в url строки БД; после переезда сид-фото на конвейер
 *     optimized/thumbs (same names) проверяем НАЛИЧИЕ имени в public/catalog —
 *     иначе purge корзины стирал бы файл всем «соседям» по варианту.
 *  2. Пути АБСОЛЮТНЫЕ (якорь — projectRoot из paths.ts): standalone-сервер
 *     делает chdir в .next/standalone, относительный cwd там ломает запись/удаление.
 *  3. Защита от path traversal: работаем только с basename и проверяем,
 *     что итоговый путь остался внутри целевой директории.
 */

function safeTarget(dir: string, url: string | null | undefined): string | null {
  // /uploads/ — легаси-префикс, /api/media/ — текущий (разница только в маршруте раздачи)
  if (!url || (!url.startsWith("/uploads/") && !url.startsWith("/api/media/"))) return null;
  const file = path.resolve(dir, path.basename(url));
  if (!file.startsWith(dir + path.sep)) return null; // traversal → отказ
  return file;
}

const CATALOG_SEED_DIR = path.join(PUBLIC_DIR, "catalog");

/** Имя файла принадлежит сид-набору public/catalog? Такие файлы общие — не стираем. */
function isSeedFile(url: string | null | undefined): boolean {
  if (!url) return false;
  return existsSync(path.join(CATALOG_SEED_DIR, path.basename(url)));
}

/** Физически удаляет optimized+thumb одного фото. Возвращает true, если хотя бы один файл удалён. */
export async function purgePhotoFiles(url: string, thumbUrl: string): Promise<boolean> {
  /* Сид-фото защищены независимо от того, каким путём они записаны в БД
     (/catalog/* до ремапа v2.7, /uploads/* после) — имя решает */
  if (isSeedFile(url) || isSeedFile(thumbUrl)) return false;
  let removed = false;
  const targets = [safeTarget(UPLOADS_OPT_DIR, url), safeTarget(UPLOADS_THUMB_DIR, thumbUrl)];
  for (const file of targets) {
    if (!file) continue;
    try {
      await unlink(file);
      removed = true;
    } catch {
      /* файла уже нет — ок */
    }
  }
  return removed;
}
