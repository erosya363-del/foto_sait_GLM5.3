import path from "path";
import { unlink } from "fs/promises";
import { UPLOADS_OPT_DIR, UPLOADS_THUMB_DIR } from "@/lib/paths";

/**
 * Шаг 5: физическое удаление файлов фото с диска.
 *
 * Правила безопасности:
 *  1. Удаляем ТОЛЬКО файлы из public/uploads/optimized и public/uploads/thumbs
 *     (загруженные пользователями). Сид-фото из public/catalog/ на диске не
 *     трогаем — они общие и могут использоваться несколькими записями.
 *  2. Пути АБСОЛЮТНЫЕ (якорь — projectRoot из paths.ts): standalone-сервер
 *     делает chdir в .next/standalone, относительный cwd там ломает запись/удаление.
 *  3. Защита от path traversal: работаем только с basename и проверяем,
 *     что итоговый путь остался внутри целевой директории.
 */

function safeTarget(dir: string, url: string | null | undefined): string | null {
  if (!url || !url.startsWith("/uploads/")) return null; // не uploads → не трогаем
  const file = path.resolve(dir, path.basename(url));
  if (!file.startsWith(dir + path.sep)) return null; // traversal → отказ
  return file;
}

/** Физически удаляет optimized+thumb одного фото. Возвращает true, если хотя бы один файл удалён. */
export async function purgePhotoFiles(url: string, thumbUrl: string): Promise<boolean> {
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
