#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * post-deploy-photo-smoke.mjs — SMOKE-ТЕСТ СОХРАННОСТИ ФОТО ПРИ РЕДЕПЛОЯХ
 * (ТЗ NEXT_AGENT_TASKS_REFERENCE_DATA_AND_PHOTO_PERSISTENCE.md, BLOCK F)
 *
 * Исторический баг: фото, загруженные на живой сайт, уничтожались редеплоем.
 * Доказательство исправления = РЕАЛЬНЫЙ цикл, а не «тесты зелёные»:
 *
 *   загрузили фото №1 → защищённый деплой → фото №1 осталось
 *   загрузили фото №2 → ВТОРОЙ защищённый деплой → фото №1 и №2 остались
 *   (optimized = HTTP 200, thumb = HTTP 200, запись в БД присутствует)
 *
 * РЕЖИМЫ:
 *
 * 1) Полный ЛОКАЛЬНЫЙ прогон нового деплой-пайплайна (без платформы):
 *      bun scripts/post-deploy-photo-smoke.mjs --local-pipeline
 *    Поднимает изолированный сервер из ТЕКУЩЕГО кода (origin, отдельная
 *    runtime-зона), дважды прогоняет НАСТОЯЩУЮ сборку .zscripts/build.sh
 *    (LOCK → DRAIN → FINAL SYNC → VERIFY → BUILD → ARTIFACT VERIFY →
 *    post-artifact renew) и настоящий cutover: сервер стартует ИЗ АРТЕФАКТА
 *    (как контейнер FC из tar.gz). Проверки — по HTTP против нового сервера.
 *
 * 2) Поэтапный режим против РЕАЛЬНОГО live (вокруг редеплоя владельца):
 *      bun scripts/post-deploy-photo-smoke.mjs --live-url https://<site> \
 *          --stage baseline|pre-deploy-1|post-deploy-1|pre-deploy-2|post-deploy-2
 *    [--token <SYNC_EXPORT_TOKEN>] — опционально для манифеста/счётчиков файлов.
 *    Каждый этап дописывает evidence-файл (можно вызывать в разные дни).
 *
 * EVIDENCE (ТЗ): tool-results/post-deploy-photo-persistence.json
 *   — какое фото загрузили, счётчики до/после, HTTP-статусы optimized/thumb,
 *     наличие записи в БД, пережил ли фото первый и второй деплой.
 *   Бинарники фото и секреты в Git НЕ попадают (фото генерируются на лету
 *   в tool-results/, сам JSON — исключение в .gitignore).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { spawn, execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";

const ROOT = "/home/z/my-project";
const EVIDENCE = path.join(ROOT, "tool-results", "post-deploy-photo-persistence.json");
const TMPDIR = path.join(ROOT, "tool-results", "photo-smoke-files");

/* ───────────────────────────── CLI ───────────────────────────── */

const argv = process.argv.slice(2);
function arg(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}
const LIVE_URL = arg("--live-url");
const STAGE = arg("--stage");
const TOKEN = arg("--token") || process.env.SYNC_EXPORT_TOKEN || "";
const LOCAL_PIPELINE = argv.includes("--local-pipeline");

if (!LOCAL_PIPELINE && !(LIVE_URL && STAGE)) {
  console.error(
    "Использование:\n" +
      "  bun scripts/post-deploy-photo-smoke.mjs --local-pipeline\n" +
      "  bun scripts/post-deploy-photo-smoke.mjs --live-url https://<site> --stage <baseline|pre-deploy-1|post-deploy-1|pre-deploy-2|post-deploy-2> [--token <t>]\n"
  );
  process.exit(2);
}

/* ───────────────────────── evidence-файл ───────────────────────── */

function loadEvidence() {
  try {
    return JSON.parse(fs.readFileSync(EVIDENCE, "utf8"));
  } catch {
    return { cycles: {}, notes: [] };
  }
}
function saveEvidence(ev) {
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.writeFileSync(EVIDENCE, JSON.stringify(ev, null, 2) + "\n");
  console.log(`── evidence: ${EVIDENCE}`);
}
function note(ev, text) {
  ev.notes.push(`${new Date().toISOString()} ${text}`);
}

/* ───────────────────────── HTTP-помощники ───────────────────────── */

async function jfetch(url, opts = {}, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, cache: "no-store" });
    const status = res.status;
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status, body, ok: res.ok };
  } finally {
    clearTimeout(t);
  }
}

async function photoCount(base) {
  const r = await jfetch(`${base}/api/admin?view=photos`);
  if (r.status !== 200 || !Array.isArray(r.body?.items))
    throw new Error(`GET /api/admin?view=photos → ${r.status}`);
  return r.body.items;
}

async function manifestCounts(base, token) {
  if (!token) return { optimizedCount: null, thumbCount: null, method: "недоступно (нет токена)" };
  try {
    const r = await jfetch(`${base}/api/admin/export`, {
      headers: { "X-Sync-Token": token },
    });
    if (r.status !== 200) return { optimizedCount: null, thumbCount: null, method: `export HTTP ${r.status}` };
    return {
      optimizedCount: r.body?.uploads?.optimized?.length ?? null,
      thumbCount: r.body?.uploads?.thumbs?.length ?? null,
      method: "export manifest",
    };
  } catch (e) {
    return { optimizedCount: null, thumbCount: null, method: `export error: ${e}` };
  }
}

async function httpOk(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    // прочитаем тело, чтобы соединение не висело
    await r.arrayBuffer().catch(() => {});
    return r.status;
  } catch (e) {
    return `ERR:${e?.cause?.code ?? e?.message ?? "fetch"}`;
  }
}

/* ─────────────────────── тестовые фото (sharp) ─────────────────────── */

async function makeTestPhoto(label) {
  fs.mkdirSync(TMPDIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(TMPDIR, `smoke-${label}-${stamp}.jpg`);
  const svg = Buffer.from(
    `<svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg">
       <rect width="1200" height="800" fill="#20455e"/>
       <rect x="40" y="40" width="1120" height="720" fill="none" stroke="#7fd6c2" stroke-width="10"/>
       <text x="600" y="380" font-size="64" fill="#ffffff" text-anchor="middle" font-family="sans-serif">POST-DEPLOY SMOKE</text>
       <text x="600" y="470" font-size="52" fill="#7fd6c2" text-anchor="middle" font-family="sans-serif">${label}</text>
       <text x="600" y="540" font-size="36" fill="#cfd8dc" text-anchor="middle" font-family="sans-serif">${new Date().toISOString()}</text>
     </svg>`
  );
  await sharp(svg).jpeg({ quality: 88 }).toFile(file);
  return file;
}

async function uploadPhoto(base, file, categoryId, modelId, comment) {
  const fd = new FormData();
  /* NB: роут читает fd.getAll("photos") — имя поля БЕЗ квадратных скобок
     (комментарий в route.ts «photos[]» неточен, проверено по коду) */
  fd.append("photos", new Blob([fs.readFileSync(file)], { type: "image/jpeg" }), path.basename(file));
  fd.append("categoryId", categoryId);
  fd.append("modelId", modelId);
  fd.append("comment", comment);
  const r = await jfetch(`${base}/api/upload`, { method: "POST", body: fd }, 180000);
  if (r.status !== 200) throw new Error(`POST /api/upload → ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  if (r.body?.ok !== true || typeof r.body?.uploaded !== "number" || r.body.uploaded < 1)
    throw new Error(`upload: ничего не загружено: ${JSON.stringify(r.body).slice(0, 300)}`);
  /* контракт /api/upload: { ok, variantId, uploaded: <число>, rejected } —
     само фото вычитываем из /api/admin?view=photos по variantId+комментарию */
  return { variantId: r.body.variantId, comment };
}

/** Найти фото по variantId + comment (view=photos отдаёт comment, id, url, thumbUrl). */
async function resolvePhoto(base, variantId, comment) {
  const items = await photoCount(base);
  const rows = items.filter((p) => p.variantId === variantId && p.comment === comment);
  if (rows.length !== 1) throw new Error(`фото variantId=${variantId} comment=${comment}: найдено ${rows.length} (ожидалось 1)`);
  return rows[0];
}

async function getOrCreateDictionaries(base) {
  /* Предпочитаем КАНОНИЧЕСКУЮ пару (появляется на live после сидирования):
     ничего лишнего в справочниках не создаём. Fallback «Smoke Bed» — только
     если справочники пусты (изолированные среды без сидирования). */
  const d = (await jfetch(`${base}/api/dictionaries`)).body;
  let cat = d.categories.find((c) => c.name === "Диваны") ?? d.categories.find((c) => c.name === "Кровати");
  if (!cat) {
    const r = await jfetch(`${base}/api/admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: "category", action: "create", name: "Кровати" }),
    });
    if (!r.ok) throw new Error(`create category: ${r.status}`);
    cat = { id: r.body.id, name: "Кровати" };
  }
  let model = d.models.find((m) => m.categoryName === cat.name && m.name === "Бонни");
  if (!model) {
    const r = await jfetch(`${base}/api/admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: "model", action: "create", name: "Smoke Bed", categoryId: cat.id }),
    });
    if (!r.ok) throw new Error(`create model: ${r.status} ${JSON.stringify(r.body)}`);
    model = { id: r.body.id, name: "Smoke Bed" };
  }
  return { categoryId: cat.id, modelId: model.id };
}

/** Полная проверка одного фото на данном сервере: БД + optimized + thumb. */
async function verifyPhoto(base, photo) {
  const items = await photoCount(base);
  const row = items.find((p) => p.url === photo.url || p.id === photo.id);
  const optStatus = await httpOk(`${base}${photo.url}`);
  const thumbStatus = await httpOk(`${base}${photo.thumbUrl}`);
  return {
    dbVisible: Boolean(row),
    optimizedStatus: optStatus,
    thumbStatus: thumbStatus,
    pass: Boolean(row) && optStatus === 200 && thumbStatus === 200,
  };
}

function countSnapshot(items, counts) {
  return {
    photoCount: items.length,
    optimizedCount: counts.optimizedCount,
    thumbCount: counts.thumbCount,
  };
}

function countsNotBackwards(before, after) {
  // фото и файлы не должны «уехать назад» после деплоя
  if (after.photoCount < before.photoCount) return false;
  if (before.optimizedCount != null && after.optimizedCount != null && after.optimizedCount < before.optimizedCount) return false;
  if (before.thumbCount != null && after.thumbCount != null && after.thumbCount < before.thumbCount) return false;
  return true;
}

/* ═══════════════════ РЕЖИМ 2: поэтапный против live ═══════════════════ */

async function runStaged() {
  const base = LIVE_URL.replace(/\/+$/, "");
  const ev = loadEvidence();
  ev.liveUrl = base;
  ev.environment = ev.environment ?? "real-live";
  ev.updatedAt = new Date().toISOString();

  if (STAGE === "baseline") {
    const items = await photoCount(base);
    const counts = await manifestCounts(base, TOKEN);
    const samples = items.slice(0, 2).map((p) => ({
      id: p.id,
      url: p.url,
      thumbUrl: p.thumbUrl,
      optimizedStatus: null,
      thumbStatus: null,
    }));
    for (const s of samples) {
      s.optimizedStatus = await httpOk(`${base}${s.url}`);
      s.thumbStatus = await httpOk(`${base}${s.thumbUrl}`);
    }
    ev.startedAt = ev.startedAt ?? new Date().toISOString();
    ev.before = { ...countSnapshot(items, counts), method: counts.method, samples };
    note(ev, `baseline: фото=${items.length}, optimized=${counts.optimizedCount}, thumbs=${counts.thumbCount}`);
  } else if (STAGE === "pre-deploy-1" || STAGE === "pre-deploy-2") {
    const n = STAGE === "pre-deploy-1" ? "1" : "2";
    const itemsBefore = await photoCount(base);
    const countsBefore = await manifestCounts(base, TOKEN);
    const dict = await getOrCreateDictionaries(base);
    const file = await makeTestPhoto(`CYCLE${n}`);
    const ref = await uploadPhoto(
      base,
      file,
      dict.categoryId,
      dict.modelId,
      `post-deploy-photo-smoke cycle${n}`
    );
    const uploaded = await resolvePhoto(base, ref.variantId, ref.comment);
    const check = await verifyPhoto(base, uploaded);
    if (!check.pass) throw new Error(`фото №${n} не прошло проверку ДО деплоя: ${JSON.stringify(check)}`);
    ev.cycle1 = ev.cycle1 ?? {};
    ev.cycle2 = ev.cycle2 ?? {};
    ev[`cycle${n}`].testPhoto = {
      file: path.basename(file),
      id: uploaded.id,
      url: uploaded.url,
      thumbUrl: uploaded.thumbUrl,
      comment: `post-deploy-photo-smoke cycle${n}`,
    };
    ev[`cycle${n}`].beforeDeploy = "PASS";
    ev[`cycle${n}`].beforeDeployDetails = {
      countsBefore: countSnapshot(itemsBefore, countsBefore),
      checkBefore: check,
    };
    note(ev, `pre-deploy-${n}: фото загружено ${uploaded.url} (до: ${itemsBefore.length} фото)`);
  } else if (STAGE === "post-deploy-1" || STAGE === "post-deploy-2") {
    const n = STAGE === "post-deploy-1" ? "1" : "2";
    const cyc = ev[`cycle${n}`] || {};
    if (!cyc.testPhoto) throw new Error(`post-deploy-${n}: нет записи о тестовом фото (сначала pre-deploy-${n})`);
    const check = await verifyPhoto(base, cyc.testPhoto);
    const itemsAfter = await photoCount(base);
    const countsAfter = await manifestCounts(base, TOKEN);
    // «counts not backwards»: сравниваем с моментом ДО деплоя (pre-deploy-N)
    const pre = cyc.beforeDeployDetails?.countsBefore;
    const okCounts = pre ? countsNotBackwards(pre, countSnapshot(itemsAfter, countsAfter)) : null;
    ev[`cycle${n}`].afterDeploy = check.pass && okCounts !== false ? "PASS" : "FAIL";
    ev[`cycle${n}`].afterDeployDetails = {
      checkAfter: check,
      countsAfter: countSnapshot(itemsAfter, countsAfter),
      countsNotBackwards: okCounts,
      verifiedAt: new Date().toISOString(),
    };
    note(
      ev,
      `post-deploy-${n}: dbVisible=${check.dbVisible}, optimized=${check.optimizedStatus}, thumb=${check.thumbStatus}, countsOk=${okCounts}`
    );
    if (STAGE === "post-deploy-2") {
      const r1 = ev.cycle1?.afterDeploy,
        r2 = ev.cycle2?.afterDeploy;
      ev.result = r1 === "PASS" && r2 === "PASS" ? "PASS" : "FAIL";
    }
  } else {
    throw new Error(`неизвестный stage: ${STAGE}`);
  }
  saveEvidence(ev);
  console.log(`✅ stage ${STAGE} завершён`);
}

/* ═══════════════════ РЕЖИМ 1: полный локальный пайплайн ═══════════════════ */

const ISO = path.join(ROOT, "tool-results", "photo-smoke-runtime");
const SMOKE_TOKEN = "smoke-sync-token-" + crypto.randomBytes(8).toString("hex");
let children = [];

function spawnChild(name, cmd, args, opts = {}) {
  const log = fs.openSync(path.join(TMPDIR, `${name}.log`), "a");
  const child = spawn(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ["ignore", log, log],
  });
  children.push(child);
  child.on("exit", (code) => {
    const i = children.indexOf(child);
    if (i >= 0) children.splice(i, 1);
  });
  return child;
}

async function waitReady(base, timeoutMs, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await jfetch(`${base}/api/dictionaries`, {}, 5000);
      if (r.status === 200) return;
    } catch {
      /* ещё не поднялся */
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`сервер ${what} не поднялся за ${timeoutMs} мс`);
}

function killChildren() {
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {}
  }
  const deadline = Date.now() + 5000;
  while (children.length && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
  for (const c of children) {
    try {
      c.kill("SIGKILL");
    } catch {}
  }
  children = [];
}

function run(cmd, args, env, label, logFile) {
  console.log(`   ▶ ${label}: ${cmd} ${args.join(" ").slice(0, 120)}…`);
  let out = "";
  try {
    out = execFileSync(cmd, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    }).toString();
  } catch (e) {
    // stdout+stderr упавшего процесса — в лог для разбора, затем rethrow
    const txt = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    if (logFile) fs.writeFileSync(logFile, txt);
    throw new Error(`${label} упал (код ${e.status}): ${String(e.stderr ?? e.message).slice(-600)}`);
  }
  if (logFile) fs.writeFileSync(logFile, out);
  return out;
}

async function startStandalone(base, port, dbFile, runtimeRoot, what) {
  const standalone = path.join(ROOT, ".next", "standalone");
  spawnChild(what, "bun", ["server.js"], {
    cwd: standalone,
    env: {
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      ...(dbFile ? { DATABASE_URL: `file:${dbFile}` } : {}),
      ...(runtimeRoot ? { RUNTIME_ROOT: runtimeRoot } : {}),
      SYNC_EXPORT_TOKEN: SMOKE_TOKEN,
    },
  });
  await waitReady(base, 90000, what);
}

function latestArtifact(buildId) {
  const p = `/tmp/build_fullstack_${buildId}.tar.gz`;
  if (!fs.existsSync(p)) throw new Error(`артефакт не найден: ${p}`);
  return p;
}

function cutover(artifact, extractDir, port) {
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["-xzf", artifact, "-C", extractDir], { timeout: 180000 });
  const dist = path.join(extractDir, "next-service-dist");
  const db = path.join(extractDir, "db", "custom.db");
  if (!fs.existsSync(path.join(dist, "server.js"))) throw new Error("в артефакте нет next-service-dist/server.js");
  if (!fs.existsSync(db)) throw new Error("в артефакте нет db/custom.db");
  const base = `http://127.0.0.1:${port}`;
  spawnChild(`cutover-${port}`, "bun", ["server.js"], {
    cwd: dist,
    env: {
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      DATABASE_URL: `file:${db}`,
      SYNC_EXPORT_TOKEN: SMOKE_TOKEN,
    },
  });
  return { base, db, dist };
}

async function protectedDeploy(buildId, liveBase, runtimeRoot, label) {
  const logFile = path.join(TMPDIR, `build-${buildId}.log`);
  console.log(`   ▶ защищённая сборка ${label} (build.sh, BUILD_ID=${buildId})…`);
  const log = run("bash", [".zscripts/build.sh"], {
    BUILD_ID: buildId,
    LIVE_BASE_URL: liveBase,
    RUNTIME_ROOT: runtimeRoot,
    SYNC_EXPORT_TOKEN: SMOKE_TOKEN,
    NEXT_TELEMETRY_DISABLED: "1",
  }, label, logFile);
  /* build.sh печатает «   lock: <uuid> (expiresAt…)» в обычном режиме и
     «deploy-lock получен: <uuid>» в bootstrap-ветке — берём оба формата */
  const lockId =
    (log.match(/^\s+lock: ([0-9a-f-]{36})/m) ?? log.match(/deploy-lock получен: ([0-9a-f-]{36})/) ?? [])[1] ?? null;
  const renewed = /lock .* продлён \(TTL (\d+)s\)/.exec(log);
  return { artifact: latestArtifact(buildId), lockId, finalRenewSec: renewed ? Number(renewed[1]) : null };
}

async function runLocalPipeline() {
  const ev = loadEvidence();
  const startedAt = new Date().toISOString();
  console.log("═══ POST-DEPLOY PHOTO SMOKE — локальный полный пайплайн ═══");
  console.log(`── изолированная runtime-зона: ${ISO}`);

  fs.rmSync(ISO, { recursive: true, force: true });
  fs.mkdirSync(path.join(ISO, "database"), { recursive: true });
  fs.mkdirSync(TMPDIR, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "db", "schema-template-empty.db"), path.join(ISO, "database", "custom.db"));

  /* 1) сборка текущего кода и запуск ORIGIN (аналог живого контейнера) */
  console.log("── [1] сборка текущего кода (bun run build)…");
  run("bun", ["run", "build"], {}, "origin-build", path.join(TMPDIR, "origin-build.log"));
  const ORIGIN = "http://127.0.0.1:3441";
  console.log("── [2] origin-сервер :3441 (изолированная runtime-зона)…");
  await startStandalone(ORIGIN, 3441, null, ISO, "origin");

  /* 2) справочники для загрузки + baseline */
  console.log("── [3] сидирование справочников в изолированную зону…");
  run("bun", ["scripts/seed-reference-data.ts", "--apply"], { RUNTIME_ROOT: ISO }, "seed", path.join(TMPDIR, "seed.log"));
  const dict = await getOrCreateDictionaries(ORIGIN);

  const baselineItems = await photoCount(ORIGIN);
  const baselineCounts = { optimizedCount: null, thumbCount: null }; // пустая зона — считать нечего
  const before = countSnapshot(baselineItems, baselineCounts);
  console.log(`── baseline: фото=${before.photoCount}`);

  ev.environment = "local-pipeline-simulation";
  ev.startedAt = startedAt;
  ev.liveUrl = ORIGIN;
  ev.before = { ...before, note: "изолированная среда: оптимизированных файлов в старте нет" };
  ev.cycle1 = {};
  ev.cycle2 = {};
  ev.deploys = [];

  /* ═══ ЦИКЛ 1 ═══ */
  console.log("── [4] ЦИКЛ 1: загрузка фото №1 через /api/upload…");
  const f1 = await makeTestPhoto("CYCLE1");
  const up1ref = await uploadPhoto(ORIGIN, f1, dict.categoryId, dict.modelId, "post-deploy-photo-smoke cycle1");
  const up1 = await resolvePhoto(ORIGIN, up1ref.variantId, up1ref.comment);
  const c1before = await verifyPhoto(ORIGIN, up1);
  if (!c1before.pass) throw new Error(`фото №1 не прошло ДО деплоя: ${JSON.stringify(c1before)}`);
  ev.cycle1.testPhoto = { file: path.basename(f1), id: up1.id, url: up1.url, thumbUrl: up1.thumbUrl };
  ev.cycle1.beforeDeploy = "PASS";
  ev.cycle1.beforeDeployDetails = { check: c1before };
  console.log(`   фото №1: ${up1.url} — БД ✓, media ✓`);

  console.log("── [5] ЦИКЛ 1: защищённый деплой (LOCK→DRAIN→SYNC→VERIFY→BUILD→ARTIFACT)…");
  const d1 = await protectedDeploy("SMOKE1", ORIGIN, ISO, "deploy-1");
  ev.deploys.push({ cycle: 1, buildId: "SMOKE1", ...d1, log: "tool-results/photo-smoke-files/build-SMOKE1.log" });

  console.log("── [6] ЦИКЛ 1: cutover — сервер из артефакта (:3442)…");
  const cut1 = cutover(d1.artifact, path.join(ROOT, "tool-results", "photo-smoke-deploy1"), 3442);
  await waitReady(cut1.base, 90000, "cutover-1");
  const c1after = await verifyPhoto(cut1.base, up1);
  const after1Items = await photoCount(cut1.base);
  ev.cycle1.afterDeploy = c1after.pass ? "PASS" : "FAIL";
  ev.cycle1.afterDeployDetails = {
    cutoverUrl: cut1.base,
    check: c1after,
    photoCount: after1Items.length,
    countsNotBackwards: countsNotBackwards({ ...before, photoCount: baselineItems.length }, countSnapshot(after1Items, { optimizedCount: null, thumbCount: null })),
  };
  console.log(`   ЦИКЛ 1 после деплоя: dbVisible=${c1after.dbVisible}, optimized=${c1after.optimizedStatus}, thumb=${c1after.thumbStatus} → ${ev.cycle1.afterDeploy}`);

  /* ═══ ЦИКЛ 2 ═══ */
  console.log("── [7] ЦИКЛ 2: загрузка фото №2 на НОВЫЙ сервер (из артефакта)…");
  const f2 = await makeTestPhoto("CYCLE2");
  const up2ref = await uploadPhoto(cut1.base, f2, dict.categoryId, dict.modelId, "post-deploy-photo-smoke cycle2");
  const up2 = await resolvePhoto(cut1.base, up2ref.variantId, up2ref.comment);
  const c2before = await verifyPhoto(cut1.base, up2);
  if (!c2before.pass) throw new Error(`фото №2 не прошло ДО 2-го деплоя: ${JSON.stringify(c2before)}`);
  ev.cycle2.testPhoto = { file: path.basename(f2), id: up2.id, url: up2.url, thumbUrl: up2.thumbUrl };
  ev.cycle2.beforeDeploy = "PASS";
  ev.cycle2.beforeDeployDetails = { check: c2before };
  console.log(`   фото №2: ${up2.url} — БД ✓, media ✓`);

  console.log("── [8] ЦИКЛ 2: второй защищённый деплой…");
  const d2 = await protectedDeploy("SMOKE2", cut1.base, ISO, "deploy-2");
  ev.deploys.push({ cycle: 2, buildId: "SMOKE2", ...d2, log: "tool-results/photo-smoke-files/build-SMOKE2.log" });

  console.log("── [9] ЦИКЛ 2: cutover №2 — сервер из артефакта (:3443)…");
  const cut2 = cutover(d2.artifact, path.join(ROOT, "tool-results", "photo-smoke-deploy2"), 3443);
  await waitReady(cut2.base, 90000, "cutover-2");
  const c1final = await verifyPhoto(cut2.base, up1);
  const c2final = await verifyPhoto(cut2.base, up2);
  const finalItems = await photoCount(cut2.base);
  ev.cycle2.afterDeploy = c1final.pass && c2final.pass ? "PASS" : "FAIL";
  ev.cycle2.afterDeployDetails = {
    cutoverUrl: cut2.base,
    photo1: c1final,
    photo2: c2final,
    photoCount: finalItems.length,
  };
  console.log(`   ЦИКЛ 2 после деплоя: фото№1 db=${c1final.dbVisible} opt=${c1final.optimizedStatus} thumb=${c1final.thumbStatus}; фото№2 db=${c2final.dbVisible} opt=${c2final.optimizedStatus} thumb=${c2final.thumbStatus}`);

  /* pre-existing фото из baseline не теряются (в изолированной среде их не было —
     но проверим связку «загруженные ДО деплоя 1 живут и после деплоя 2») */
  ev.result = ev.cycle1.afterDeploy === "PASS" && ev.cycle2.afterDeploy === "PASS" ? "PASS" : "FAIL";
  ev.finishedAt = new Date().toISOString();
  note(ev, `локальный пайплайн: результат ${ev.result} (финальный сервер ${cut2.base}, фото=${finalItems.length})`);
  saveEvidence(ev);
  console.log(`═══ ИТОГ: ${ev.result} ═══`);
  if (ev.result !== "PASS") process.exit(1);
}

/* ───────────────────────────── main ───────────────────────────── */

try {
  if (LOCAL_PIPELINE) await runLocalPipeline();
  else await runStaged();
} catch (e) {
  console.error("✗ SMOKE FAIL:", e?.message ?? e);
  const ev = loadEvidence();
  note(ev, `FAIL: ${e?.message ?? e}`);
  saveEvidence(ev);
  process.exitCode = 1;
} finally {
  killChildren();
}
