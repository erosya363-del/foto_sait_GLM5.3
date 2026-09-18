import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { RUNTIME_ROOT } from "@/lib/runtime";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CRITICAL STABILITY PART 1.1 — ATOMIC LIVE DEPLOY LOCK (ТЗ 1–2).
 *
 * ПЕРВОПРИЧИНА: гонка «sync-from-live → сотрудник грузит фото → build».
 * Свежий маркер синка НЕ доказывает актуальность артефакта: фото, загруженное
 * на live ПОСЛЕ синка, в артефакт не попадает, а деплой уничтожает контейнер
 * вместе с ним (так потерялись ~20 фото). Нужна атомарная схема:
 *
 *   LOCK LIVE WRITES → WAIT ACTIVE WRITES = 0 → FINAL SYNC → VERIFY → BUILD
 *
 * Как это работает:
 *   • Deploy-lock: файл RUNTIME_ROOT/.deploy-write-lock.json с TTL
 *     (30 минут по умолчанию). Истёк/повреждён → считается отсутствующим
 *     и удаляется (stale lock не блокирует систему навсегда).
 *   • Writer lease: каждая runtime-мутация (upload/fabric-photo/admin) на
 *     время работы создаёт файл RUNTIME_ROOT/.runtime-writers/<uuid>.json.
 *     Схема «check lock → lease → RE-check lock» закрывает гонку
 *     «мутация началась до lock, завершится после snapshot»:
 *       1. проверяет deploy-lock;
 *       2. создаёт lease;
 *       3. ЕЩЁ РАЗ проверяет deploy-lock;
 *       4. если lock появился между шагами — удаляет lease и возвращает LOCKED;
 *       5. выполняет мутацию;
 *       6. finally удаляет lease.
 *   → deploy-lock endpoint дожидается (drain) всех УЖЕ НАЧАТЫХ мутаций,
 *     прежде чем разрешить final sync.
 *   • Renew (REV.2): действующий lock продлевается heartbeat'ом сборки
 *     (action:"renew" → renewDeployLock, только владелец lockId); потерянный/
 *     истёкший lock продлить НЕЛЬЗЯ — сборка падает fail-closed.
 *
 * ФАЙЛЫ LOCK/LEASE НЕ ПОПАДАЮТ В АРТЕФАКТ: database-runtime-build.sh кладёт
 * в артефакт только db/, uploads/ и .sync-token — корневые служебные файлы
 * runtime-зоны (.deploy-write-lock.json, .runtime-writers/) туда не копируются.
 *
 * Lock живёт на диске РЯДОМ с данными → исчезает вместе со старым контейнером
 * после cutover (ТЗ 4.3) или сам истекает по TTL, если деплой-платформа упала.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface DeployWriteLock {
  id: string;
  createdAt: string;
  expiresAt: string;
  reason: "deploy";
  owner?: string;
}

interface WriterLeaseFile {
  id: string;
  source: string;
  createdAt: string;
  pid: number;
}

/** Файл deploy-lock — в корне runtime-зоны (в артефакт НЕ копируется). */
export const DEPLOY_LOCK_FILE = path.join(RUNTIME_ROOT, ".deploy-write-lock.json");
/** Каталог активных writer-lease (в артефакт НЕ копируется). */
export const RUNTIME_WRITERS_DIR = path.join(RUNTIME_ROOT, ".runtime-writers");

/** TTL deploy-lock по умолчанию: 30 минут (ТЗ 1.1). */
export const DEFAULT_LOCK_TTL_MS = 30 * 60 * 1000;
/**
 * Lease старше этого возраста считается «мертвым» (crash процесса без finally)
 * и не блокирует drain — иначе упавший upload заблокировал бы деплой навсегда.
 * Равен TTL lock: дольше 30 минут ни одна мутация по контракту не живёт.
 */
const LEASE_STALE_MS = 30 * 60 * 1000;
/** Интервал опроса writer-lease при drain. */
const DRAIN_POLL_MS = 150;

/** Ошибка «lock уже установлен» (несёт действующий lock для ответа 409). */
export class DeployLockExistsError extends Error {
  readonly lock: DeployWriteLock;
  constructor(lock: DeployWriteLock) {
    super("deploy-lock уже установлен: " + lock.id);
    this.name = "DeployLockExistsError";
    this.lock = lock;
  }
}

/** Ошибка «writers не освободились за timeout» (ответ 503 + снятие lock). */
export class WritersDrainTimeoutError extends Error {
  readonly activeWriters: number;
  constructor(activeWriters: number, timeoutMs: number) {
    super(`активные writers не завершились за ${timeoutMs} мс (осталось: ${activeWriters})`);
    this.name = "WritersDrainTimeoutError";
    this.activeWriters = activeWriters;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Валидный ли JSON-объект lock (форма, не криптография). */
function parseLock(raw: string): DeployWriteLock | null {
  try {
    const l = JSON.parse(raw) as Partial<DeployWriteLock> | null;
    if (!l || typeof l.id !== "string" || !l.id) return null;
    if (typeof l.createdAt !== "string" || typeof l.expiresAt !== "string") return null;
    return {
      id: l.id,
      createdAt: l.createdAt,
      expiresAt: l.expiresAt,
      reason: "deploy",
      ...(l.owner ? { owner: String(l.owner) } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Читает deploy-lock. Истёк (expiresAt < now) или повреждён → считает
 * отсутствующим, удаляет stale-файл (ТЗ 1.1) и возвращает null.
 */
export function readDeployLockSync(): DeployWriteLock | null {
  let raw: string;
  try {
    raw = fs.readFileSync(DEPLOY_LOCK_FILE, "utf8");
  } catch {
    return null; // нет файла — lock отсутствует (норма)
  }
  const lock = parseLock(raw);
  const expired = !lock || Date.parse(lock.expiresAt) <= Date.now();
  if (expired) {
    // stale lock: удаляем, чтобы не лежал мусором (best-effort; ENOENT — гонка, ок)
    try {
      fs.unlinkSync(DEPLOY_LOCK_FILE);
    } catch {
      /* уже удалён конкурентом */
    }
    return null;
  }
  return lock;
}

/** Async-версия для route handlers (ТЗ 1.3 currentDeployLock). */
export async function currentDeployLock(): Promise<DeployWriteLock | null> {
  return readDeployLockSync();
}

/**
 * Атомарно создаёт deploy-lock. Если действует валидный lock — бросает
 * DeployLockExistsError (endpoint вернёт 409; НИКОГДА не перезаписывает чужой).
 * Атомарность: запись во временный файл + link() (не создаёт второй файл при
 * гонке двух acquirer'ов — выигрывает ровно один).
 */
export async function acquireDeployLock(
  ttlMs: number = DEFAULT_LOCK_TTL_MS,
  owner?: string
): Promise<DeployWriteLock> {
  const existing = readDeployLockSync();
  if (existing) throw new DeployLockExistsError(existing);

  fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
  const now = Date.now();
  const ttl = Math.max(1000, ttlMs);
  const lock: DeployWriteLock = {
    id: randomUUID(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl).toISOString(),
    reason: "deploy",
    ...(owner ? { owner } : {}),
  };

  const tmp = `${DEPLOY_LOCK_FILE}.tmp-${randomUUID()}`;
  fs.writeFileSync(tmp, JSON.stringify(lock, null, 2) + "\n", { flag: "wx" });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.linkSync(tmp, DEPLOY_LOCK_FILE); // атомарно: EEXIST, если кто-то успел
        return lock;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException | null)?.code;
        if (code !== "EEXIST") throw e;
        // Кто-то создал lock между нашей проверкой и link — перечитываем:
        // возможно, это stale lock, который мы сами сейчас удалим и повторим.
        const winner = readDeployLockSync();
        if (winner) throw new DeployLockExistsError(winner);
      }
    }
    throw new DeployLockExistsError(parseLock(fs.readFileSync(DEPLOY_LOCK_FILE, "utf8")) ?? {
      id: "unknown",
      createdAt: "",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      reason: "deploy",
    });
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* уже удалён */
    }
  }
}

/**
 * Снимает deploy-lock ТОЛЬКО с совпадающим id (ТЗ 3.3). Отсутствующий lock
 * считается снятым (idempotent). Чужой/несовпадающий id → false.
 */
export async function releaseDeployLock(lockId: string): Promise<boolean> {
  const current = readDeployLockSync();
  if (!current) return true; // уже нет (истёк/снят) — цель достигнута
  if (current.id !== lockId) return false;
  try {
    fs.unlinkSync(DEPLOY_LOCK_FILE);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code === "ENOENT") return true;
    throw e;
  }
}

/**
 * REV.2 (отзыв владельца п.2): продлевает ДЕЙСТВУЮЩИЙ deploy-lock —
 * heartbeat сборки вызывает это каждые LOCK_HEARTBEAT_SEC, чтобы длинная
 * сборка не «пережила» TTL lock'а.
 *
 * FAIL-CLOSED: продлить можно ТОЛЬКО lock с совпадающим id. Истёкший
 * (readDeployLockSync уже удалил stale-файл), снятый или чужой lock → null —
 * вызывающая сторона (route → build.sh) обязана интерпретировать это как
 * «защита потеряна» и остановить сборку, а не продолжать с «полу-live» lock'ом.
 *
 * Атомарность продления: tmp-файл + rename() — читатели (readDeployLockSync)
 * в любой момент видят либо старый, либо новый валидный lock, никогда
 * пустой/полузаписанный файл.
 */
export async function renewDeployLock(
  lockId: string,
  ttlMs: number = DEFAULT_LOCK_TTL_MS
): Promise<DeployWriteLock | null> {
  const current = readDeployLockSync();
  if (!current || current.id !== lockId) return null;
  const ttl = Math.max(1000, ttlMs);
  const renewed: DeployWriteLock = {
    ...current,
    expiresAt: new Date(Date.now() + ttl).toISOString(),
  };
  const tmp = `${DEPLOY_LOCK_FILE}.tmp-${randomUUID()}`;
  fs.writeFileSync(tmp, JSON.stringify(renewed, null, 2) + "\n");
  try {
    fs.renameSync(tmp, DEPLOY_LOCK_FILE); // атомарная подмена (POSIX)
  } finally {
    try {
      fs.unlinkSync(tmp); // после успешного rename файла уже нет — ENOENT, ок
    } catch {
      /* уже забран rename'ом */
    }
  }
  return renewed;
}

/** Список активных (не-стейл) writer-lease. Stale физически удаляется. */
export function listActiveWriterLeases(): WriterLeaseFile[] {
  let names: string[];
  try {
    names = fs.readdirSync(RUNTIME_WRITERS_DIR);
  } catch {
    return []; // каталога нет — writers нет
  }
  const now = Date.now();
  const out: WriterLeaseFile[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const full = path.join(RUNTIME_WRITERS_DIR, name);
    try {
      const lease = JSON.parse(fs.readFileSync(full, "utf8")) as Partial<WriterLeaseFile> | null;
      const created = Date.parse(String(lease?.createdAt ?? ""));
      if (!Number.isFinite(created) || now - created > LEASE_STALE_MS) {
        // мертвый lease (crash без finally) — уборка, в count не попадает
        fs.unlinkSync(full);
        continue;
      }
      out.push({
        id: String(lease?.id ?? name),
        source: String(lease?.source ?? "?"),
        createdAt: new Date(created).toISOString(),
        pid: Number(lease?.pid ?? 0),
      });
    } catch {
      /* повреждённый lease — считаем stale и убираем */
      try {
        fs.unlinkSync(full);
      } catch {
        /* конкурент уже удалил */
      }
    }
  }
  return out;
}

/** Число активных runtime-мутаций (для статуса deploy-lock, ТЗ 3.4). */
export async function activeWriters(): Promise<number> {
  return listActiveWriterLeases().length;
}

/**
 * Ждёт, пока все начатые мутации завершатся (active writers = 0).
 * Timeout → WritersDrainTimeoutError (endpoint снимет lock и вернёт 503).
 */
export async function waitForRuntimeWriters(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    const n = listActiveWriterLeases().length;
    if (n === 0) return;
    if (Date.now() >= deadline) throw new WritersDrainTimeoutError(n, timeoutMs);
    await sleep(DRAIN_POLL_MS);
  }
}

export type RuntimeWriteTicket =
  | { ok: true; id: string; release: () => Promise<void> }
  | { ok: false; lock: DeployWriteLock };

/**
 * ТЗ 1.2/1.3: БЕРЁТ writer-lease под runtime-мутацию.
 * Схема «check → lease → re-check» гарантирует: либо мутация видна
 * deploy-lock'у через lease (он дождётся), либо мутация не начнётся.
 * Вызов ОБЯЗАН жить в try { … } finally { await writer.release(); }.
 */
export async function beginRuntimeWrite(source: string): Promise<RuntimeWriteTicket> {
  // 1. проверяет deploy-lock
  const pre = readDeployLockSync();
  if (pre) return { ok: false, lock: pre };

  // 2. создаёт lease
  fs.mkdirSync(RUNTIME_WRITERS_DIR, { recursive: true });
  const id = randomUUID();
  const leaseFile = path.join(RUNTIME_WRITERS_DIR, `${id}.json`);
  const lease: WriterLeaseFile = {
    id,
    source,
    createdAt: new Date().toISOString(),
    pid: process.pid,
  };
  try {
    fs.writeFileSync(leaseFile, JSON.stringify(lease) + "\n", { flag: "wx" });
  } catch {
    // невозможный на практике случай (uuid-коллизия) — честно отказываем
    const lock = readDeployLockSync();
    if (lock) return { ok: false, lock };
    throw new Error("runtime writer lease: не удалось создать lease-файл");
  }

  // 3–4. ЕЩЁ РАЗ проверяет deploy-lock: появился между шагами → LOCKED
  const post = readDeployLockSync();
  if (post) {
    try {
      fs.unlinkSync(leaseFile);
    } catch {
      /* конкурент-уборка уже удалила */
    }
    return { ok: false, lock: post };
  }

  // 5–6. мутация выполняется у вызывающего; finally удаляет lease
  let released = false;
  return {
    ok: true,
    id,
    release: async () => {
      if (released) return;
      released = true;
      try {
        fs.unlinkSync(leaseFile);
      } catch {
        /* уже нет — ок */
      }
    },
  };
}

/**
 * ТЗ 1.4: единый ответ «идёт деплой» для ВСЕХ заблокированных мутаций.
 * Пользователь видит понятный текст, а не «Ошибка сервера».
 */
export function runtimeLockedResponse(lock: DeployWriteLock): NextResponse {
  return NextResponse.json(
    {
      error: "Идёт обновление приложения. Повторите через несколько минут.",
      code: "DEPLOY_LOCKED",
      retryAfter: 60,
      lockId: lock.id,
      lockExpiresAt: lock.expiresAt,
    },
    {
      status: 423, // 423 Locked
      headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    }
  );
}
