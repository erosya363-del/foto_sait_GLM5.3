/**
 * REGRESSION-ТЕСТ СОХРАННОСТИ ФОТО (этап 6 ТЗ стабилизации).
 *
 * Доказывает сценарий владельца:
 *   «Пользователь загрузил фото → разработчик поменял код → build → deploy →
 *    restart → build → restart → все фото на месте, БД не тронута».
 *
 * Механика:
 *   1. Фикстура: tool-results/regression-runtime/ = ПОЛНАЯ КОПИЯ production
 *      runtime-зоны (оригинал read-only, не участвует).
 *   2. Изолированный сервер: PORT=3200, RUNTIME_ROOT=<фикстура>.
 *   3. Создаём категорию+модель+3 фото через живой API (POST /api/upload).
 *   4. Снимок: id/url строк, sha256 всех файлов фикстуры.
 *   5. bun run build (полная production сборка) → проверка: фикстура не тронута,
 *      в .next/standalone нет runtime-данных (prune сработал).
 *   6. Рестарт сервера на той же фикстуре → сверка строк+файлов+HTTP 200.
 *   7. Ещё один build+restart → та же сверка.
 *   8. Production runtime-зона сверяется до/после всего прогона (md5).
 *
 * Результат: PASS/FAIL по каждому пункту + JSON в tool-results/regression-result.json
 * Запуск: bun scripts/regression-photo-persistence.mjs
 */
import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";

const ROOT = "/home/z/my-project";
const PROD_RUNTIME = path.join(ROOT, "download", "runtime");
const FIXTURE = path.join(ROOT, "tool-results", "regression-runtime");
const STANDALONE = path.join(ROOT, ".next", "standalone", "server.js");
const PORT = 3200;
const BASE = `http://localhost:${PORT}`;
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
  console.log(results[results.length - 1]);
}

function dirSnapshot(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const rel of ["database/custom.db", "database/custom.db-wal", "database/custom.db-shm"]) {
    const p = path.join(dir, rel);
    if (fs.existsSync(p)) out[rel] = sha(p);
  }
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const rel = path.join(prefix, e.name);
      if (e.isDirectory()) walk(full, rel);
      else out[rel] = sha(full);
    }
  };
  walk(path.join(dir, "uploads"), "uploads");
  return out;
}

async function startServer() {
  const child = spawn("node", [STANDALONE], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), RUNTIME_ROOT: FIXTURE, NODE_ENV: "production" },
    stdio: "ignore",
    detached: false,
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/catalog`);
      if (r.ok) return child;
    } catch { /* ждём */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("сервер :3200 не поднялся");
}

function stopServer(child) {
  child.kill("SIGKILL");
  return new Promise((r) => setTimeout(r, 700));
}

async function apiAdmin(body) {
  const r = await fetch(`${BASE}/api/admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function main() {
  console.log("── REGRESSION: сохранность фото при build/restart ──");
  const prodBefore = dirSnapshot(PROD_RUNTIME);

  // [1] Фикстура = копия production runtime
  fs.rmSync(FIXTURE, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
  execSync(`cp -a "${PROD_RUNTIME}" "${FIXTURE}"`);
  const fixtureBase = dirSnapshot(FIXTURE);
  console.log(`   фикстура: ${Object.keys(fixtureBase).length} файлов (копия production)`);

  // [2] Изолированный сервер
  let proc = await startServer();
  console.log(`   сервер :${PORT} поднят на фикстуре`);

  // [3] Тестовые данные через API
  const catName = `РегрессКат-${Date.now()}`;
  const cat = await apiAdmin({ entity: "category", action: "create", name: catName });
  check("создана тестовая категория", cat.ok, JSON.stringify(cat));
  const mdl = await apiAdmin({ entity: "model", action: "create", name: `РегрессМодель-${Date.now()}`, categoryId: cat.id });
  check("создана тестовая модель", mdl.ok, JSON.stringify(mdl));

  const fd = new FormData();
  fd.append("categoryId", cat.id);
  fd.append("modelId", mdl.id);
  for (let i = 0; i < 3; i++) {
    const buf = await sharp({
      create: { width: 600 + i * 100, height: 400, channels: 3, background: ["#2dd4bf", "#0d9488", "#134e4a"][i] },
    }).jpeg().toBuffer();
    fd.append("photos", new Blob([buf], { type: "image/jpeg" }), `regression-${i}.jpg`);
  }
  const up = await (await fetch(`${BASE}/api/upload`, { method: "POST", body: fd })).json();
  check("загружено 3 фото", up.ok && up.uploaded === 3, JSON.stringify(up));

  const photosView = await (await fetch(`${BASE}/api/admin?view=photos`)).json();
  const mine = photosView.items.filter((p) => p.categoryName === catName);
  check("3 строки Photo в БД", mine.length === 3, `найдено ${mine.length}`);
  const beforeRows = mine.map((p) => ({ id: p.id, url: p.url, thumbUrl: p.thumbUrl }));

  // [4] Снимок фикстуры с тестовыми данными
  const beforeSnap = dirSnapshot(FIXTURE);
  const newFiles = Object.keys(beforeSnap).filter((k) => !(k in fixtureBase));
  check("на диске 6 новых файлов (3 optimized + 3 thumbs)", newFiles.length === 6, `${newFiles.length}: ${newFiles.join(", ")}`);

  // HTTP-снимок содержимого фото
  const httpBefore = {};
  for (const row of beforeRows) {
    const r = await fetch(`${BASE}${row.url}`);
    httpBefore[row.url] = { status: r.status, hash: crypto.createHash("sha256").update(Buffer.from(await r.arrayBuffer())).digest("hex") };
  }
  check("все 3 optimized отдаются HTTP 200", Object.values(httpBefore).every((x) => x.status === 200));

  await stopServer(proc);

  // БАЗА сравнения — состояние ПОСЛЕ остановки сервера (при живом SQLite
  // активно пишет WAL — снимок «на бегу» не байтово-стабилен, это не баг сборки)
  let snapAfterStop = dirSnapshot(FIXTURE);

  // [5..7] Два цикла: build → restart → сверка
  for (let cycle = 1; cycle <= 2; cycle++) {
    console.log(`── ЦИКЛ ${cycle}: production build + restart ──`);
    execSync("bun run build", { cwd: ROOT, stdio: "pipe" });

    // Фикстура не изменилась сборкой (сравнение с состоянием после остановки сервера)
    const afterBuild = dirSnapshot(FIXTURE);
    const sameKeys = Object.keys(afterBuild).length === Object.keys(snapAfterStop).length
      && Object.keys(snapAfterStop).every((k) => afterBuild[k] === snapAfterStop[k]);
    check(`цикл ${cycle}: фикстура побайтово не тронута build'ом`, sameKeys,
      `было ${Object.keys(snapAfterStop).length} файлов, стало ${Object.keys(afterBuild).length}`);

    // В standalone нет runtime-данных
    const baked = fs.existsSync(path.join(ROOT, ".next/standalone/download"))
      || fs.existsSync(path.join(ROOT, ".next/standalone/db"))
      || fs.existsSync(path.join(ROOT, ".next/standalone/public/uploads"));
    check(`цикл ${cycle}: в .next/standalone нет runtime-данных (prune)`, !baked);

    // Рестарт + сверка
    proc = await startServer();
    const photosAfter = await (await fetch(`${BASE}/api/admin?view=photos`)).json();
    const mineAfter = photosAfter.items.filter((p) => beforeRows.some((b) => b.id === p.id));
    const rowsSame = beforeRows.every((b) => {
      const a = mineAfter.find((x) => x.id === b.id);
      return a && a.url === b.url && a.thumbUrl === b.thumbUrl;
    }) && mineAfter.length === 3;
    check(`цикл ${cycle}: строки Photo идентичны (id/url)`, rowsSame, `найдено ${mineAfter.length}/3`);

    let httpOk = true, hashOk = true;
    for (const row of beforeRows) {
      const r = await fetch(`${BASE}${row.url}`);
      if (r.status !== 200) { httpOk = false; continue; }
      const h = crypto.createHash("sha256").update(Buffer.from(await r.arrayBuffer())).digest("hex");
      if (h !== httpBefore[row.url].hash) hashOk = false;
    }
    check(`цикл ${cycle}: фото отдаются HTTP 200`, httpOk);
    check(`цикл ${cycle}: содержимое фото побайтово то же (sha256)`, hashOk);

    await stopServer(proc);
    snapAfterStop = dirSnapshot(FIXTURE);
  }

  // [8] Production runtime не тронут всем прогоном
  const prodAfter = dirSnapshot(PROD_RUNTIME);
  const prodSame = JSON.stringify(prodBefore) === JSON.stringify(prodAfter);
  check("production runtime-зона не тронута всем прогоном", prodSame,
    `файлов до ${Object.keys(prodBefore).length}, после ${Object.keys(prodAfter).length}`);

  // Итог
  console.log(`\n══════ ИТОГ: PASS ${pass} / FAIL ${fail} ══════`);
  fs.writeFileSync(
    path.join(ROOT, "tool-results", "regression-result.json"),
    JSON.stringify({ at: new Date().toISOString(), pass, fail, results }, null, 2)
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("REGRESSION CRASH:", e);
  process.exit(1);
});
