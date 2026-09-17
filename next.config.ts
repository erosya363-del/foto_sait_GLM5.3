import type { NextConfig } from "next";
import { execSync } from "child_process";
import { createRequire } from "module";

/**
 * ЕДИНЫЙ ИСТОЧНИК ВЕРСИИ (СТАБИЛИЗАЦИЯ, этап 17 ТЗ):
 * версия = package.json.version + git short SHA (build date не нужен — SHA
 * однозначно определяет деплой). Инлайнится в клиентский бандл на этапе
 * сборки (NEXT_PUBLIC_APP_VERSION), ручное редактирование в UI запрещено.
 * Вне git-репозитория (деплой без .git) — только версия из package.json.
 */
function appVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = require("./package.json") as { version?: string };
  let sha = "";
  try {
    sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    /* нет git — деплой-контейнер */
  }
  return sha ? `v${pkg.version} · ${sha}` : `v${pkg.version}`;
}

const nextConfig: NextConfig = {
  output: "standalone",
  // FIX deploy: Turbopack ошибочно определял workspace root (в дереве есть
  // чужие node_modules/lockfile выше проекта) -> в .next/standalone НЕ
  // создавался server.js -> платформенный деплой падал ("problem deploying
  // the code"). Явный root гарантирует корректный standalone-вывод.
  turbopack: {
    root: process.cwd(),
  },
  // СТАБИЛИЗАЦИЯ (этап 10): обход TypeScript-ошибок УДАЛЕН.
  // Production build обязан падать при реальной TS-ошибке (раньше стояло
  // typescript.ignoreBuildErrors: true).
  reactStrictMode: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion(),
  },
};

export default nextConfig;
