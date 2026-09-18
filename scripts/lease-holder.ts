/**
 * lease-holder.ts — ТЕСТОВЫЙ ХЕЛПЕР (scripts/test-live-sync-race.sh §10.1):
 * держит РЕАЛЬНЫЙ writer-lease (через beginRuntimeWrite из production-кода),
 * пока не появится файл-сигнал release. Доказывает, что deploy-lock endpoint
 * ДОЖИДАЕТСЯ начатой мутации (drain), а не «отмахивается» от неё.
 *
 * Использование:
 *   RUNTIME_ROOT=<зона> bun scripts/lease-holder.ts <source> <releaseFile> <stateFile>
 *
 * Протокол (stateFile):
 *   "LOCKED"          — beginRuntimeWrite вернул ok:false (не удалось взять lease)
 *   "HELD:<id>"       — lease взят и удерживается
 *   "RELEASED"        — release-файл появился, lease удалён, выход
 */
import fs from "fs";

const [, , source, releaseFile, stateFile] = process.argv;
if (!source || !releaseFile || !stateFile) {
  console.error("usage: RUNTIME_ROOT=<зона> bun scripts/lease-holder.ts <source> <releaseFile> <stateFile>");
  process.exit(1);
}

// Динамический импорт ПОСЛЕ установки env: модуль читает RUNTIME_ROOT при загрузке
const { beginRuntimeWrite } = await import("../src/lib/runtime-write-lock");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function writeState(s: string) {
  fs.writeFileSync(stateFile, s);
}

const ticket = await beginRuntimeWrite(source);
if (!ticket.ok) {
  await writeState("LOCKED");
  process.exit(2);
}
await writeState("HELD:" + ticket.id);

while (!fs.existsSync(releaseFile)) {
  await sleep(40);
}
await ticket.release();
await writeState("RELEASED");
process.exit(0);
