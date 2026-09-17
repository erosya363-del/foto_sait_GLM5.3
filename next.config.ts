import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // FIX deploy: Turbopack ошибочно определял workspace root (в дереве есть
  // чужие node_modules/lockfile выше проекта) -> в .next/standalone НЕ
  // создавался server.js -> платформенный деплой падал ("problem deploying
  // the code"). Явный root гарантирует корректный standalone-вывод.
  turbopack: {
    root: process.cwd(),
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
