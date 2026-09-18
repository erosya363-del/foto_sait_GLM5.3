import { NextRequest, NextResponse } from "next/server";
import { isSyncAuthorized } from "@/lib/sync-auth";
import {
  acquireDeployLock,
  releaseDeployLock,
  renewDeployLock,
  currentDeployLock,
  waitForRuntimeWriters,
  activeWriters,
  DeployLockExistsError,
  WritersDrainTimeoutError,
  DEFAULT_LOCK_TTL_MS,
} from "@/lib/runtime-write-lock";

export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CRITICAL STABILITY PART 1.1 §3 — DEPLOY LOCK API.
 *
 * ЗАЧЕМ: перед сборкой артефакта build-пайплайн (.zscripts/build.sh) обязан
 *   LOCK LIVE WRITES → WAIT ACTIVE WRITES = 0 → FINAL SYNC → BUILD.
 * Пока lock активен, все runtime-мутации (upload/fabric-photo/admin) отвечают
 * 423 DEPLOY_LOCKED — ни одно фото не может «въехать» между sync и build.
 *
 * ЗАЩИТА: ТЕМ ЖЕ техническим токеном, что /api/admin/export
 * (X-Sync-Token / Authorization: Bearer; см. src/lib/sync-auth.ts).
 * Никакого публичного lock/unlock: без валидного токена — 401 fail-closed.
 *
 * POST { "action": "lock", "ttlSec": 1800, "owner": "deploy" }
 *   1. auth; 2. атомарное создание lock (чужой lock → 409 ALREADY_LOCKED);
 *   3. после создания lock новые writers уже не стартуют (423);
 *   4. ждать active writers = 0 (timeout 120 c);
 *   5. не дождались → lock СНЯТ, ответ 503 WRITERS_BUSY;
 *   6. успех → { ok, lockId, expiresAt, activeWriters: 0 }.
 *
 * POST { "action": "unlock", "lockId": "..." }
 *   Снять можно ТОЛЬКО lock с совпадающим id (чужой/старый id → 409).
 *
 * POST { "action": "renew", "lockId": "...", "ttlSec": 1800 }   (REV.2 п.2)
 *   Продлить ДЕЙСТВУЮЩИЙ lock (heartbeat сборки продлевает его во время
 *   сборки, чтобы длинная сборка не пережила TTL). Только владелец lockId:
 *   lock истёк/снят/чужой → 409 LOCK_NOT_RENEWABLE (fail-closed — build.sh
 *   обязан упасть, а не продолжать без защиты).
 *
 * GET → статус: { locked, lock, activeWriters } (тоже token-protected).
 *
 * ВАЖНО (ТЗ 4.3): build НЕ снимает lock после УСПЕШНОЙ сборки — lock исчезает
 * вместе со старым контейнером после cutover или истекает по TTL. Снятие при
 * ОШИБКЕ сборки делает сам build.sh (trap cleanup).
 * ═══════════════════════════════════════════════════════════════════════════
 */

const DRAIN_TIMEOUT_MS = 120_000;
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 3_600_000;

const noStore = { "Cache-Control": "no-store" } as const;

export async function GET(req: NextRequest) {
  if (!(await isSyncAuthorized(req))) {
    return NextResponse.json(
      { error: "Требуется заголовок X-Sync-Token (или Authorization: Bearer) с SYNC_EXPORT_TOKEN сервера." },
      { status: 401, headers: noStore }
    );
  }
  const lock = await currentDeployLock();
  return NextResponse.json(
    { locked: Boolean(lock), lock, activeWriters: await activeWriters() },
    { headers: noStore }
  );
}

export async function POST(req: NextRequest) {
  if (!(await isSyncAuthorized(req))) {
    return NextResponse.json(
      { error: "Требуется заголовок X-Sync-Token (или Authorization: Bearer) с SYNC_EXPORT_TOKEN сервера." },
      { status: 401, headers: noStore }
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { action?: string; lockId?: string; ttlSec?: number; owner?: string }
    | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json(
      { error: "Ожидается JSON { action: 'lock'|'unlock'|'renew', … }" },
      { status: 400, headers: noStore }
    );
  }

  /* ── LOCK: атомарно создать → дождаться drain writers ── */
  if (body.action === "lock") {
    const reqTtl = Number(body.ttlSec);
    const ttlSec = Number.isFinite(reqTtl) && reqTtl > 0 ? reqTtl : DEFAULT_LOCK_TTL_MS / 1000;
    const ttlMs = Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, ttlSec * 1000));
    const owner = typeof body.owner === "string" && body.owner ? body.owner.slice(0, 64) : "deploy";

    let lock;
    try {
      lock = await acquireDeployLock(ttlMs, owner);
    } catch (e) {
      if (e instanceof DeployLockExistsError) {
        return NextResponse.json(
          { error: "Deploy-lock уже действует.", code: "ALREADY_LOCKED", lock: e.lock },
          { status: 409, headers: noStore }
        );
      }
      throw e;
    }

    // С этого момента новые writers получают 423; дожидаемся начатых.
    try {
      await waitForRuntimeWriters(DRAIN_TIMEOUT_MS);
    } catch (e) {
      // ТЗ 3.2.6: writers не освободились → снять lock, честный 503
      await releaseDeployLock(lock.id).catch(() => {});
      if (e instanceof WritersDrainTimeoutError) {
        return NextResponse.json(
          {
            error: "Активные записи не завершились за отведённое время — попробуйте ещё раз.",
            code: "WRITERS_BUSY",
            activeWriters: e.activeWriters,
          },
          { status: 503, headers: { ...noStore, "Retry-After": "30" } }
        );
      }
      throw e;
    }

    return NextResponse.json(
      { ok: true, lockId: lock.id, expiresAt: lock.expiresAt, activeWriters: 0 },
      { headers: noStore }
    );
  }

  /* ── RENEW: продлить действующий lock (heartbeat сборки, REV.2 п.2) ── */
  if (body.action === "renew") {
    const lockId = typeof body.lockId === "string" ? body.lockId : "";
    if (!lockId) {
      return NextResponse.json(
        { error: "Нужен lockId действующего deploy-lock.", code: "LOCK_ID_REQUIRED" },
        { status: 400, headers: noStore }
      );
    }
    const reqTtl = Number(body.ttlSec);
    const ttlSec = Number.isFinite(reqTtl) && reqTtl > 0 ? reqTtl : DEFAULT_LOCK_TTL_MS / 1000;
    const ttlMs = Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, ttlSec * 1000));
    const renewed = await renewDeployLock(lockId, ttlMs);
    if (!renewed) {
      // lock истёк/снят/чужой → продлить НЕЛЬЗЯ (fail-closed, REV.2 п.2)
      return NextResponse.json(
        {
          error: "Deploy-lock отсутствует (истёк/снят) или lockId не совпадает — продлить нельзя.",
          code: "LOCK_NOT_RENEWABLE",
        },
        { status: 409, headers: noStore }
      );
    }
    return NextResponse.json(
      { ok: true, lockId: renewed.id, expiresAt: renewed.expiresAt },
      { headers: noStore }
    );
  }

  /* ── UNLOCK: только владелец lockId ── */
  if (body.action === "unlock") {
    const lockId = typeof body.lockId === "string" ? body.lockId : "";
    if (!lockId) {
      return NextResponse.json(
        { error: "Нужен lockId того lock'а, который ставился.", code: "LOCK_ID_REQUIRED" },
        { status: 400, headers: noStore }
      );
    }
    const ok = await releaseDeployLock(lockId);
    if (!ok) {
      return NextResponse.json(
        { error: "lockId не совпадает с действующим deploy-lock — снять нельзя.", code: "LOCK_ID_MISMATCH" },
        { status: 409, headers: noStore }
      );
    }
    return NextResponse.json({ ok: true }, { headers: noStore });
  }

  return NextResponse.json(
    { error: "Неизвестное действие. Ожидалось action: 'lock' | 'unlock' | 'renew'." },
    { status: 400, headers: noStore }
  );
}
