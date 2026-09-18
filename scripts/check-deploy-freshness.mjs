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
 *   3. маркер достаточно свежий (FRESH_SYNC_MAX_HOURS, по умолчанию 72) —
 *      ПРИ ЗАДАННОМ DEPLOY_LOCK_ID это только ДИАГНОСТИКА (ТЗ PART 1.1 §5.2:
 *      production truth = привязка маркера к ТЕКУЩЕМУ deploy-lock);
 *   4. photoCount маркера == фактическое число живых Photo в БД;
 *   5. optimizedCount/thumbCount маркера == фактические файлы на диске;
 *   6. dbSha256 маркера == sha256 текущего файла БД — РАСХОЖДЕНИЕ БЛОКИРУЕТ
 *      деплой (PART 1.1 §6: раньше был warning, теперь FAIL — runtime
 *      изменился ПОСЛЕ final sync → нужен повторный sync под deploy-lock);
 *   7. все Photo-ссылки целы (verify-runtime-artifact.mjs);
 *   8. lockId маркера == process.env.DEPLOY_LOCK_ID, если тот задан
 *      (PART 1.1 §5.1: маркер от прошлого build/чужого lock → BLOCK).
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

/* ═══ PART 1.1 §5.1: ПРИВЯЗКА МАРКЕРА К ТЕКУЩЕМУ DEPLOY LOCK ═══
   production-пайплайн задаёт DEPLOY_LOCK_ID (build.sh экспортирует id живого
   lock'а). Маркер БЕЗ lockId или С ДРУГИМ lockId = синк от прошлого build —
   деплой БЛОКИРУЕТСЯ независимо от возраста маркера. */
const wantLockId = process.env.DEPLOY_LOCK_ID || "";
if (wantLockId) {
  if (!marker.lockId) {
    fail(
      "в маркере нет lockId — синк выполнен БЕЗ deploy-lock (старый формат)",
      "Повторите final sync под deploy-lock (сборка делает это автоматически)."
    );
  }
  if (marker.lockId !== wantLockId) {
    fail(
      `lockId маркера (${String(marker.lockId).slice(0, 12)}…) ≠ текущему deploy-lock (${wantLockId.slice(0, 12)}…)`,
      "Маркер от прошлого build или другого lock. Повторите final sync под ТЕКУЩИМ deploy-lock."
    );
  }
}

/* 3. Свежесть. При заданном DEPLOY_LOCK_ID — только ДИАГНОСТИКА (ТЗ §5.2:
   истинная защита — привязка к текущему lock'у); в ручном режиме (без lock
   инфраструктуры) остаётся fail-closed. */
const syncedAt = Date.parse(marker.syncedAt);
if (!Number.isFinite(syncedAt)) fail(`некорректная дата syncedAt: ${marker.syncedAt}`);
const ageH = (Date.now() - syncedAt) / 3600000;
if (ageH > MAX_HOURS) {
  const msg = `sync-маркер устарел: ${marker.syncedAt} (${ageH.toFixed(1)} ч назад > ${MAX_HOURS} ч)`;
  if (wantLockId) {
    console.warn(
      `⚠ DEPLOY GUARD (диагностика): ${msg}\n` +
        "  Свежесть гарантирует привязка lockId к ТЕКУЩЕМУ deploy-lock (PART 1.1 §5.2); возраст — справочно."
    );
  } else {
    fail(
      msg,
      "Фото, загруженные на живой сайт после синка, НЕ в локальной зоне. Перед деплоем:\n" +
        "    bash scripts/sync-from-live.sh " + (marker.source || "https://<site>.space-z.ai") + " --yes"
    );
  }
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
        /* PART 1.1 §9: lstat — symlink НЕ считается обычным media-файлом */
        const st = fs.lstatSync(path.join(dir, n));
        return st.isFile() && !st.isSymbolicLink();
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

/* 6. dbSha256 — РАСХОЖДЕНИЕ БЛОКИРУЕТ ДЕПЛОЙ (PART 1.1 §6).
   Прежний console.warn допускал деплой зоны, изменившейся ПОСЛЕ final sync —
   ровно та дыра, через которую артефакт «немного отставал» от live. */
const dbSha = crypto.createHash("sha256").update(fs.readFileSync(DB_FILE)).digest("hex");
if (marker.dbSha256 && marker.dbSha256 !== dbSha) {
  fail(
    "runtime DB изменилась после final sync",
    "Повторите final sync под deploy-lock (сборка делает это автоматически).\n" +
      `  sync=${String(marker.dbSha256).slice(0, 10)}…, сейчас=${dbSha.slice(0, 10)}…`
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
  `✅ DEPLOY GUARD: PASS — sync ${marker.syncedAt} (${ageH.toFixed(1)} ч назад), photos=${livePhotos}, opt=${opt}, thm=${thm}, источник ${marker.source}` +
    (wantLockId ? `, lock ${String(marker.lockId).slice(0, 12)}… (текущий ✓)` : "")
);
