#!/usr/bin/env bun
/**
 * check-deploy-freshness.mjs — DEPLOY GUARD: fresh sync marker (ТЗ CRITICAL STABILITY 2.4/2.5).
 *
 * Проверяет, что runtime-зона синхронизирована с живым сайтом ПОСЛЕДНЕЙ
 * (маркер .live-sync.json, который пишет scripts/sync-from-live.sh) и что
 * данные ЦЕЛЫ. Без этого деплой собирает артефакт из УСТАРЕВШЕЙ зоны и
 * уничтожает фото, загруженные на живой сайт после прошлого синка — именно
 * так пропали ~20 фотографий (root cause подтверждён forensics 2026-09-19).
 *
 * Проверки (fail-closed, любое нарушение → EXIT 1):
 *   1. runtime-БД существует;
 *   2. маркер download/runtime/.live-sync.json существует;
 *   3. маркер достаточно свежий (FRESH_SYNC_MAX_HOURS, по умолчанию 72);
 *   4. photoCount маркера == фактическое число живых Photo в БД;
 *   5. optimizedCount/thumbCount маркера == фактические файлы на диске;
 *   6. dbSha256 маркера == sha256 текущего файла БД (зона не подменена
 *      после синка посторонней копией);
 *   7. все Photo-ссылки целы (verify-runtime-artifact.mjs).
 *
 * Escape hatch: RUNTIME_BOOTSTRAP_EMPTY=1 — явный флаг чистой установки
 * (согласован с src/lib/runtime.ts): guard предупреждает и пропускает данные.
 *
 * Использование:
 *   bun scripts/check-deploy-freshness.mjs [RUNTIME_ROOT]
 *     RUNTIME_ROOT по умолчанию <проект>/download/runtime
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = path.resolve(
  process.argv[2] || process.env.RUNTIME_ROOT || path.join(process.cwd(), "download", "runtime")
);
const DB_FILE = path.join(ROOT, "database", "custom.db");
const MARKER = path.join(ROOT, ".live-sync.json");
const MAX_HOURS = Number(process.env.FRESH_SYNC_MAX_HOURS || 72);

function fail(msg, hint) {
  console.error("✗ DEPLOY GUARD: BLOCKED — " + msg);
  if (hint) console.error("  " + hint);
  process.exit(1);
}

/* Escape hatch чистой установки — то же правило, что в src/lib/runtime.ts */
if (process.env.RUNTIME_BOOTSTRAP_EMPTY === "1") {
  console.warn("⚠ DEPLOY GUARD: RUNTIME_BOOTSTRAP_EMPTY=1 — данные НЕ проверяются (чистая установка). На живой сайт без синка не деплоить!");
  process.exit(0);
}

/* 1. БД существует */
if (!fs.existsSync(DB_FILE)) {
  fail(
    `runtime-БД отсутствует: ${DB_FILE}`,
    "Восстановление: bash scripts/restore-runtime.sh <архив.tar.gz>  |  Список: ls -1t download/backups/runtime-*.tar.gz"
  );
}

/* 2. Маркер существует */
if (!fs.existsSync(MARKER)) {
  fail(
    `нет fresh-sync маркера: ${MARKER}`,
    "Runtime-зона не синхронизирована с живым сайтом. Перед сборкой/деплоем выполните:\n" +
      "    bash scripts/sync-from-live.sh https://<site>.space-z.ai --yes\n" +
      "  и повторите сборку. Деплой несинхронизированной зоны уничтожает данные, загруженные на живой сайт."
  );
}

let marker;
try {
  marker = JSON.parse(fs.readFileSync(MARKER, "utf8"));
} catch (e) {
  fail(`маркер повреждён (${e.message})`, "Перезапустите bash scripts/sync-from-live.sh <BASE_URL> --yes");
}
const required = ["source", "syncedAt", "dbSha256", "photoCount", "optimizedCount", "thumbCount"];
const missing = required.filter((k) => marker[k] === undefined);
if (missing.length) {
  fail(`в маркере нет полей: ${missing.join(", ")}`, "Маркер старого формата — перезапустите scripts/sync-from-live.sh");
}

/* 3. Свежесть */
const syncedAt = Date.parse(marker.syncedAt);
if (!Number.isFinite(syncedAt)) fail(`некорректная дата syncedAt: ${marker.syncedAt}`);
const ageH = (Date.now() - syncedAt) / 3600000;
if (ageH > MAX_HOURS) {
  fail(
    `sync-маркер устарел: ${marker.syncedAt} (${ageH.toFixed(1)} ч назад > ${MAX_HOURS} ч)`,
    "Фото, загруженные на живой сайт после синка, НЕ в локальной зоне. Перед деплоем:\n" +
      "    bash scripts/sync-from-live.sh " + (marker.source || "https://<site>.space-z.ai") + " --yes"
  );
}

/* 4. photoCount */
let db;
try {
  const { Database } = require("bun:sqlite");
  db = new Database(DB_FILE, { readonly: true });
} catch (e) {
  fail("БД не открывается: " + e.message);
}
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => String(t.name).toLowerCase());
const table = tables.includes("photos") ? "photos" : tables.includes("photo") ? "photo" : null;
if (!table) fail("в БД нет таблицы photos");
let livePhotos;
try {
  livePhotos = db.query(`SELECT COUNT(*) c FROM ${table} WHERE "deletedAt" IS NULL`).get().c;
} catch {
  livePhotos = db.query(`SELECT COUNT(*) c FROM ${table}`).get().c;
}
if (Number(marker.photoCount) !== Number(livePhotos)) {
  fail(
    `photoCount маркера (${marker.photoCount}) ≠ живых Photo в runtime-БД (${livePhotos})`,
    "Зона менялась ПОСЛЕ синка (тесты/локальные загрузки). Нужен свежий sync перед деплоем:\n" +
      "    bash scripts/sync-from-live.sh " + (marker.source || "https://<site>.space-z.ai") + " --yes"
  );
}
db.close();

/* 5. media counts */
function countFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => {
      try {
        return fs.statSync(path.join(dir, n)).isFile();
      } catch {
        return false;
      }
    }).length;
  } catch {
    return 0;
  }
}
const opt = countFiles(path.join(ROOT, "uploads", "optimized"));
const thm = countFiles(path.join(ROOT, "uploads", "thumbs"));
if (Number(marker.optimizedCount) !== opt || Number(marker.thumbCount) !== thm) {
  fail(
    `media-счётчики маркера (opt=${marker.optimizedCount}, thm=${marker.thumbCount}) ≠ на диске (opt=${opt}, thm=${thm})`,
    "Файлы добавлялись/удалялись после синка — нужен свежий sync перед деплоем."
  );
}

/* 6. dbSha256 */
const dbSha = crypto.createHash("sha256").update(fs.readFileSync(DB_FILE)).digest("hex");
if (marker.dbSha256 && marker.dbSha256 !== dbSha) {
  console.warn(
    `⚠ DEPLOY GUARD: sha256 БД отличается от синхронизированного (sync=${marker.dbSha256.slice(0, 10)}…, сейчас=${dbSha.slice(0, 10)}…).\n` +
      "  Это допустимо только для локальных тестовых правок (dev-сервер открыл БД).\n" +
      "  Если живой сайт НЕ получит эти правки — данные локальных правок будут потеряны при деплое."
  );
}

/* 7. Ссылки целы */
console.log("── DEPLOY GUARD [7/7]: проверка photo-ссылок (verify-runtime-artifact)…");
const verify = Bun.spawnSync({
  cmd: [process.execPath, path.join(process.cwd(), "scripts", "verify-runtime-artifact.mjs"), ROOT, "--quiet"],
  stdout: "inherit",
  stderr: "inherit",
});
if (verify.exitCode !== 0) {
  fail("verify-runtime-artifact не прошёл — в runtime-зоне битые photo-ссылки");
}

console.log(
  `✅ DEPLOY GUARD: PASS — sync ${marker.syncedAt} (${ageH.toFixed(1)} ч назад), photos=${livePhotos}, opt=${opt}, thm=${thm}, источник ${marker.source}`
);
