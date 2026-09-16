import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";

// Раздача резервных копий проекта (public/sait_copy_N.tar.gz) через API.
// Зачем: edge-шлюз отдаёт статику из снапшота на момент пробуждения песочницы,
// новые файлы из public/ снаружи 404; динамика (/api/*) проксируется живьём.
// Безопасность: отдаём только имена вида sait_copy_<число>.tar.gz.

const NAME_RE = /^sait_copy_[0-9]+\.tar\.gz$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  if (!NAME_RE.test(name)) {
    return Response.json({ error: "Недопустимое имя файла" }, { status: 400 });
  }

  // production standalone: cwd = .next/standalone → файл ищем в standalone/public,
  // в исходном public/ проекта и по абсолютному пути (на случай другого cwd у деплоя).
  const candidates = [
    path.join(process.cwd(), "public", name),
    path.join(process.cwd(), "..", "..", "public", name),
    path.join("/home/z/my-project/public", name),
  ];
  const file = candidates.find((p) => {
    try {
      return existsSync(p) && statSync(p).isFile();
    } catch {
      return false;
    }
  });

  if (!file) {
    return Response.json({ error: "Файл не найден" }, { status: 404 });
  }

  const size = statSync(file).size;
  const stream = Readable.toWeb(
    createReadStream(file)
  ) as ReadableStream<Uint8Array>;

  return new Response(stream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
