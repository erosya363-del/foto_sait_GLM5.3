import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { UPLOADS_OPT_DIR, UPLOADS_THUMB_DIR } from "@/lib/paths";

export const dynamic = "force-dynamic";

/**
 * Шаг 5: раздача загруженных файлов МИНУЯ статический хендлер Next.
 *
 * Почему: standalone-сервер кэширует список public-файлов на старте и делает
 * chdir в .next/standalone — свежезагруженные файлы отдавались 404 до
 * рестарта, а ребилд стирал их. Этот роут читает файлы напрямую из
 * <проект>/public/uploads (абсолютные пути) — всегда актуально.
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

  // Только optimized/ и thumbs/ внутри uploads — остальное отдаёт статика Next
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
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  }
}
