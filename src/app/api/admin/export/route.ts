import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import {
  UPLOADS_OPT_DIR,
  UPLOADS_THUMB_DIR,
  RUNTIME_ROOT,
} from "@/lib/runtime";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/export — выгрузка RUNTIME-данных живого сайта.
 *
 * ЗАЧЕМ: живой контейнер — единственное место, где существуют фото, загруженные
 * через сайт. Редеплой собирает новый контейнер из артефакта и уничтожает диск
 * старого. Чтобы данные не терялись, ПЕРЕД каждым редеплоем они возвращаются
 * в рабочую область скриптом scripts/sync-from-live.sh, а следующий деплой
 * выпекает их в артефакт (.zscripts/database-runtime-build.sh).
 *
 * Форматы:
 *   GET /api/admin/export            → JSON-манифест:
 *       {
 *         generatedAt, runtimeRoot,
 *         db:  { photos, variants, categories, models, materials, sizes, tags, stockItems },
 *         uploads: {
 *           optimized: [{ name, bytes, sha256 }, ...],
 *           thumbs:    [{ name, bytes, sha256 }, ...]
 *         }
 *       }
 *   GET /api/admin/export?part=db    → сам файл БД (консистентный снапшот
 *       через VACUUM INTO во временный файл — живой WAL не читаем напрямую).
 *
 * Файлы фото скачиваются ОТДЕЛЬНО по именам из манифеста через публичный
 * /api/media/{optimized|thumbs}/<name> — так синхронизация идёт штатными
 * маршрутами приложения и не тащит произвольные пути.
 *
 * Доступ: уровень остальных /api/admin/* (внутренний контур каталога).
 * Ответ всегда no-store (middleware /api/*) — выгрузка не кэшируется.
 */

interface UploadFileInfo {
  name: string;
  bytes: number;
  sha256: string;
}

async function listUploads(dir: string): Promise<UploadFileInfo[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return []; // каталог может ещё не существовать на чистой установке
  }
  const out: UploadFileInfo[] = [];
  for (const name of entries.sort()) {
    const full = path.join(dir, name);
    const st = await fs.stat(full).catch(() => null);
    if (!st || !st.isFile()) continue;
    const buf = await fs.readFile(full);
    out.push({
      name,
      bytes: st.size,
      sha256: createHash("sha256").update(buf).digest("hex"),
    });
  }
  return out;
}

async function buildManifest() {
  const [
    photos,
    variants,
    categories,
    models,
    materials,
    sizes,
    tags,
    stockItems,
    optimized,
    thumbs,
  ] = await Promise.all([
    db.photo.count(),
    db.productVariant.count(),
    db.category.count(),
    db.model.count(),
    db.material.count(),
    db.size.count(),
    db.tag.count(),
    db.stockItem.count(),
    listUploads(UPLOADS_OPT_DIR),
    listUploads(UPLOADS_THUMB_DIR),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    runtimeRoot: path.basename(RUNTIME_ROOT),
    db: { photos, variants, categories, models, materials, sizes, tags, stockItems },
    uploads: { optimized, thumbs },
  };
}

export async function GET(req: NextRequest) {
  const part = req.nextUrl.searchParams.get("part") || "";

  try {
    if (part === "db") {
      // Консистентный снапшот: VACUUM INTO снимает копию в read-транзакции,
      // поэтому параллельная загрузка фото не порвёт выгрузку.
      const snap = path.join(os.tmpdir(), `custom-export-${Date.now()}.db`);
      try {
        await db.$queryRawUnsafe(`VACUUM INTO '${snap}'`);
        const buf = await fs.readFile(snap);
        return new NextResponse(buf, {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(buf.byteLength),
            "Content-Disposition": 'attachment; filename="custom.db"',
            "Cache-Control": "no-store",
          },
        });
      } finally {
        await fs.unlink(snap).catch(() => {});
      }
    }

    const manifest = await buildManifest();
    return NextResponse.json(manifest, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("[export] Ошибка выгрузки runtime-данных:", e);
    return NextResponse.json(
      { error: "Не удалось выгрузить runtime-данные" },
      { status: 500 }
    );
  }
}
