import { timingSafeEqual } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { NextRequest } from "next/server";
import { RUNTIME_ROOT } from "@/lib/runtime";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CRITICAL STABILITY PART 1.1 §3.1 — ЕДИНАЯ ТЕХНИЧЕСКАЯ АВТОРИЗАЦИЯ SYNC-API.
 *
 * Раньше auth-логика экспорта жила прямо в /api/admin/export/route.ts; с
 * появлением /api/admin/deploy-lock её нужно разделять ДВАМЯ endpoint'ами —
 * вынесена сюда. Токен один и тот же (SYNC_EXPORT_TOKEN), сравнение —
 * crypto.timingSafeEqual (защита от timing-оракулов вместо `===`).
 *
 * Источник ожидаемого токена (приоритет, как прежде):
 *   1. env SYNC_EXPORT_TOKEN (если платформа позволяет секреты);
 *   2. файл RUNTIME_ROOT/.sync-token — zero-config (печётся в артефакт тем же
 *      пайплайном, что и данные → совпадает с сервером; в git не попадает).
 * Ни env, ни файла → API закрыт (401, fail-closed).
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function expectedSyncToken(): Promise<string | null> {
  if (process.env.SYNC_EXPORT_TOKEN) return process.env.SYNC_EXPORT_TOKEN;
  try {
    const t = (await fs.readFile(path.join(RUNTIME_ROOT, ".sync-token"), "utf8")).trim();
    return t || null;
  } catch {
    return null;
  }
}

/** Timing-safe сравнение строк. Разные длины — тоже сравниваем (профиль
 *  времени не должен выдавать длину секрета), но результат false. */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length === b.length) return timingSafeEqual(a, b);
  try {
    timingSafeEqual(a, a);
  } catch {
    /* пустой буфер — сравнивать нечем, это не утечка */
  }
  return false;
}

/**
 * true, если запрос несёт валидный серверный токен заголовком
 * X-Sync-Token: <token> или Authorization: Bearer <token>.
 */
export async function isSyncAuthorized(req: NextRequest): Promise<boolean> {
  const expected = await expectedSyncToken();
  if (!expected) return false; // токен не настроен — API закрыт (fail-closed)
  const bearer = req.headers.get("authorization");
  const sync = req.headers.get("x-sync-token");
  if (sync && tokensMatch(sync, expected)) return true;
  if (bearer && bearer.startsWith("Bearer ")) return tokensMatch(bearer.slice(7), expected);
  return false;
}
