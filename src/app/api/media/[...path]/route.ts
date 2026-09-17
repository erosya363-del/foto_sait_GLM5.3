import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { UPLOADS_OPT_DIR, UPLOADS_THUMB_DIR } from "@/lib/paths";

export const dynamic = "force-dynamic";

/**
 * СТАБИЛИЗАЦИЯ: раздача пользовательских фото через /api/media/*.
 *
 * ПОЧЕМУ НЕ /uploads/*: edge-шлюз платформы отдаёт СТАТИКУ только из снапшота
 * деплоя — файлы, добавленные в public/ после деплоя, снаружи 404 (проверено
 * probe-тестом, см. docs/FIX_REPORT.md). /api/* проксируется живьём, поэтому
 * фото, загруженные СЕЙЧАС, видны снаружи СРАЗУ и не зависят от снапшота.
 *
 * Источник файлов — RUNTIME-зона (download/runtime/uploads, src/lib/runtime.ts):
 * вне git, вне .next — ни деплой, ни rebuild не могут их затереть.
 *
 * URL /uploads/* сохранён как легаси-маршрут (те же каталоги), чтобы старые
 * ссылки/письма/кэш не ломались.
 */

const TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: parts } = await params;
  const rel = parts.join("/");

  // Только optimized/ и thumbs/ — никаких других файлов
  if (!rel.startsWith("optimized/") && !rel.startsWith("thumbs/")) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const dir = rel.startsWith("thumbs/") ? UPLOADS_THUMB_DIR : UPLOADS_OPT_DIR;
  const file = path.resolve(dir, path.basename(rel));
  if (!file.startsWith(dir + path.sep)) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  try {
    const data = await readFile(file);
    const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": type,
        "Content-Length": String(data.length),
        // имена файлов уникальны (timestamp+random) и содержимое не меняется
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  }
}
