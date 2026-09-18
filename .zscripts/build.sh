#!/bin/bash

# 将 stderr 重定向到 stdout，避免 execute_command 因为 stderr 输出而报错
exec 2>&1

set -e

# 获取脚本所在目录（.zscripts 目录，即 workspace-agent/.zscripts）
# 使用 $0 获取脚本路径（兼容 sh 和 bash）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Next.js 项目路径
NEXTJS_PROJECT_DIR="/home/z/my-project"

# 检查 Next.js 项目目录是否存在
if [ ! -d "$NEXTJS_PROJECT_DIR" ]; then
    echo "❌ 错误: Next.js 项目目录不存在: $NEXTJS_PROJECT_DIR"
    exit 1
fi

echo "🚀 开始构建 Next.js 应用和 mini-services..."
echo "📁 Next.js 项目路径: $NEXTJS_PROJECT_DIR"

# 切换到 Next.js 项目目录
cd "$NEXTJS_PROJECT_DIR" || exit 1

# 设置环境变量
export NEXT_TELEMETRY_DISABLED=1

# ═════════════════════════════════════════════════════════════════════════════
# CRITICAL STABILITY PART 1.1 §4 — BUILD САМ ДЕЛАЕТ FINAL SYNC ПОД LIVE LOCK.
#
# Пользователь БОЛЬШЕ НЕ ДОЛЖЕН помнить «sync-from-live перед каждым deploy».
# Production-схема:
#
#   ACQUIRE LIVE LOCK (POST /api/admin/deploy-lock)
#     → WAIT ACTIVE WRITES = 0 (сервер сам дренирует начатые мутации)
#     → FINAL SYNC FROM LOCKED LIVE (scripts/sync-from-live.sh, DEPLOY_LOCK_ID)
#     → VERIFY CURRENT DEPLOY LOCK ID (GET status — lock всё ещё наш)
#     → BUILD (bun run build)
#     → ARTIFACT VERIFY (database-runtime-build.sh: guard + post-build verify)
#
# Пока идёт snapshot/build, live НЕ принимает новые мутации (423 DEPLOY_LOCKED)
# — фото, загруженное сотрудником во время сборки, больше не может исчезнуть.
#
# ВРЕМЯ ЖИЗНИ LOCK (ТЗ 4.3 — ВАЖНО):
#   BUILD FAILED  → unlock СРАЗУ (trap cleanup);
#   BUILD SUCCESS → живой контейнер ОСТАЁТСЯ LOCKED: lock исчезнет вместе со
#                   старым контейнером при cutover ИЛИ сам истечёт по TTL
#                   (~30 мин), если платформа упала после успешной сборки.
#                   НЕ СНИМАТЬ руками — иначе окно «deploy → новый lock» пропустит
#                   мутации во время переключения контейнера.
#
# ПЕРВЫЙ ROLLOUT (ТЗ §11): текущий live ещё НЕ имеет deploy-lock API.
# ОДНОРАЗОВЫЙ переход: FIRST_DEPLOY_LOCK_BOOTSTRAP=1 — сборка предупреждает
# КРАСНЫМ, НЕ требует endpoint (пробует lock мягко), синк делает максимально
# ПОЗДНО, требует ручного maintenance window (запрет загрузок). После первого
# успешного деплоя флаг БОЛЬШЕ НЕ ИСПОЛЬЗОВАТЬ: обычная сборка без lock'а
# УПАДЁТ (fail-closed).
#
# RUNTIME_BOOTSTRAP_EMPTY=1 — заведомо чистая установка без данных: live-операции
# пропускаются целиком (тот же контракт, что у deploy-guard и runtime.ts).
# ═══════════════════════════════════════════════════════════════════════════

# Единый конфиг деплоя (PART 1.1 §4.2): URL живого сайта в ОДНОМ месте.
# Приоритет: env LIVE_BASE_URL → .zscripts/deploy.env.
if [ -f "$SCRIPT_DIR/deploy.env" ]; then
    # shellcheck disable=SC1091
    . "$SCRIPT_DIR/deploy.env"
fi
LIVE_BASE_URL="${LIVE_BASE_URL:-${LIVE_BASE_URL_DEFAULT:-}}"

RUNTIME_ZONE="${RUNTIME_ROOT:-$NEXTJS_PROJECT_DIR/download/runtime}"
FIRST_DEPLOY_LOCK_BOOTSTRAP="${FIRST_DEPLOY_LOCK_BOOTSTRAP:-}"

LOCK_ACQUIRED=0
BUILD_SUCCESS=0
LOCK_ID=""

live_lock_api() {
    # $1 = action-JSON; печатает тело ответа; пусто при любой ошибке сети/404
    curl -sS --max-time 30 "${AUTH_ARGS[@]}" -H 'Content-Type: application/json' \
        -X POST "$LIVE_BASE_URL/api/admin/deploy-lock" -d "$1" 2>/dev/null || true
}

json_field() {
    # $1 = JSON, $2 = имя поля; печатает значение или пусто (env — чтобы не
    # подставлять имя поля прямо в JS-код)
    printf '%s' "$1" | FIELD="$2" bun -e "
      let s=''; process.stdin.on('data',(d)=>s+=d).on('end',()=>{
        try { const v = JSON.parse(s)[process.env.FIELD]; console.log(v == null ? '' : String(v)); }
        catch { console.log(''); }
      });"
}

unlock_live() {
    # best-effort: снимаем СВОЙ lock по id (чужой сервер откажет — это норма)
    [ -n "$LOCK_ID" ] || return 0
    live_lock_api "{\"action\":\"unlock\",\"lockId\":\"$LOCK_ID\"}" > /dev/null || true
}

cleanup() {
    # ТЗ 4.4: снимаем lock ТОЛЬКО если сборка НЕ удалась. При успехе live
    # остаётся залоченным до cutover/TTL (защита окна переключения контейнера).
    if [ "$LOCK_ACQUIRED" = "1" ] && [ "$BUILD_SUCCESS" != "1" ]; then
        echo "↩︎  Сборка не удалась — снимаем deploy-lock (live снова принимает записи)…"
        unlock_live || true
    fi
}
trap cleanup EXIT INT TERM

if [ "${RUNTIME_BOOTSTRAP_EMPTY:-}" = "1" ]; then
    echo "⚠  RUNTIME_BOOTSTRAP_EMPTY=1 — live-lock/final-sync пропущены (заведомо чистая установка)"
else
    if [ -z "$LIVE_BASE_URL" ]; then
        echo "❌ LIVE_BASE_URL не задан (env или $SCRIPT_DIR/deploy.env) — сборка БЕЗ final sync запрещена." >&2
        exit 1
    fi

    # ── Токен (PART 1.1 §8): env → $RUNTIME_ZONE/.sync-token. НЕ генерируем.
    SYNC_TOKEN="${SYNC_EXPORT_TOKEN:-}"
    if [ -z "$SYNC_TOKEN" ] && [ -f "$RUNTIME_ZONE/.sync-token" ]; then
        SYNC_TOKEN="$(tr -d '[:space:]' < "$RUNTIME_ZONE/.sync-token")"
    fi
    AUTH_ARGS=()
    if [ -n "$SYNC_TOKEN" ]; then
        AUTH_ARGS=("-H" "X-Sync-Token: $SYNC_TOKEN")
    elif [ "$FIRST_DEPLOY_LOCK_BOOTSTRAP" != "1" ]; then
        echo "❌ Токен экспорта не найден (env SYNC_EXPORT_TOKEN или $RUNTIME_ZONE/.sync-token)." >&2
        echo "   Автогенерация отключена (PART 1.1 §8). Первый переход — см. sync-from-live.sh --bootstrap-token." >&2
        exit 1
    fi

    echo "🔒 LIVE: $LIVE_BASE_URL"

    if [ "$FIRST_DEPLOY_LOCK_BOOTSTRAP" = "1" ]; then
        printf '\033[31m%s\033[0m\n' "════════════════════════════════════════════════════════════════"
        printf '\033[31m%s\033[0m\n' "❗ FIRST_DEPLOY_LOCK_BOOTSTRAP=1 — ОДНОРАЗОВЫЙ переход на защищённые деплои!"
        printf '\033[31m%s\033[0m\n' "❗ Живой сайт может ещё НЕ иметь deploy-lock API; ОБЕСПЕЧЬТЕ ручной"
        printf '\033[31m%s\033[0m\n' "❗ maintenance window (запрет загрузок) на время сборки и деплоя."
        printf '\033[31m%s\033[0m\n' "❗ После первого успешного деплоя флаг БОЛЬШЕ НЕ ИСПОЛЬЗОВАТЬ."
        printf '\033[31m%s\033[0m\n' "════════════════════════════════════════════════════════════════"
        # Пробуем lock мягко: endpoint может отсутствовать на старом live
        LOCK_RESP=$(live_lock_api '{"action":"lock","ttlSec":1800,"owner":"build"}')
        LOCK_ID="$(json_field "$LOCK_RESP" lockId)"
        if [ -n "$LOCK_ID" ]; then
            LOCK_ACQUIRED=1
            echo "🔒 deploy-lock получен: $LOCK_ID"
        else
            echo "⚠ deploy-lock недоступен на live (ожидаемо для первого перехода) — final sync БЕЗ lock"
        fi
    else
        echo "🔒 [1/4] ACQUIRE LIVE LOCK…"
        LOCK_RESP=$(live_lock_api '{"action":"lock","ttlSec":1800,"owner":"build"}')
        LOCK_ID="$(json_field "$LOCK_RESP" lockId)"
        if [ -z "$LOCK_ID" ]; then
            echo "❌ deploy-lock НЕ получен — сборка ЗАБЛОКИРОВАНА (fail-closed)." >&2
            echo "   Ответ live: ${LOCK_RESP:-<нет ответа/сеть/404>}" >&2
            echo "   Возможные причины: live ещё не обновлён до кода с deploy-lock API" >&2
            echo "   (первый переход — FIRST_DEPLOY_LOCK_BOOTSTRAP=1), неверный токен," >&2
            echo "   writers не освободились (503) или уже действует чужой lock (409)." >&2
            exit 1
        fi
        LOCK_ACQUIRED=1
        echo "   lock: $LOCK_ID ($(json_field "$LOCK_RESP" expiresAt)), activeWriters=$(json_field "$LOCK_RESP" activeWriters)"
    fi

    # ── FINAL SYNC: максимально поздний, ПОД lock (live заморожен) ──
    echo "⟳  [2/4] FINAL SYNC FROM LOCKED LIVE…"
    if [ -n "$LOCK_ID" ]; then
        DEPLOY_LOCK_ID="$LOCK_ID" RUNTIME_ROOT="$RUNTIME_ZONE" \
            bash scripts/sync-from-live.sh "$LIVE_BASE_URL" --yes || exit 1
    else
        RUNTIME_ROOT="$RUNTIME_ZONE" \
            bash scripts/sync-from-live.sh "$LIVE_BASE_URL" --yes || exit 1
    fi

    # ── VERIFY CURRENT LOCK ID: lock всё ещё наш (не истёк/не снят) ──
    if [ -n "$LOCK_ID" ]; then
        echo "🛡  [3/4] VERIFY CURRENT DEPLOY LOCK ID…"
        STATUS=$(curl -sS --max-time 30 "${AUTH_ARGS[@]}" "$LIVE_BASE_URL/api/admin/deploy-lock" 2>/dev/null || true)
        CUR_ID="$(printf '%s' "$STATUS" | bun -e "
          let s=''; process.stdin.on('data',(d)=>s+=d).on('end',()=>{
            try { const j=JSON.parse(s); console.log(j.locked === true && j.lock && j.lock.id ? String(j.lock.id) : ''); }
            catch { console.log(''); }
          });")"
        if [ "$CUR_ID" != "$LOCK_ID" ]; then
            echo "❌ deploy-lock ИЗМЕНИЛСЯ/ИСТЁК во время синка ($CUR_ID ≠ $LOCK_ID) — сборка ЗАБЛОКИРОВАНА." >&2
            echo "   Данные могли снова мутировать; повторите сборку (она поставит свежий lock)." >&2
            exit 1
        fi
        echo "   lock подтверждён: $CUR_ID"
    else
        echo "🛡  [3/4] VERIFY LOCK: пропущено (bootstrap без lock — см. красное предупреждение выше)"
    fi
    echo "✅ [4/4] live заморожен и синхронизирован — можно собирать"
    # Guard'ы ниже по пайплайну (check-deploy-freshness в database-runtime-build.sh)
    # обязаны требовать marker.lockId === ТЕКУЩИЙ lock (PART 1.1 §5.1):
    if [ -n "$LOCK_ID" ]; then
        export DEPLOY_LOCK_ID="$LOCK_ID"
    fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# ТЗ CRITICAL STABILITY 2.4 — DEPLOY GUARD (pre-flight, fail fast):
# деплой НЕактуальных данных НЕВОЗМОЖЕН. После FINAL SYNC маркер свежий и
# (в production-пайплайне) привязан к DEPLOY_LOCK_ID — guard проверяет оба
# условия (PART 1.1 §5/§6). Чистая установка: RUNTIME_BOOTSTRAP_EMPTY=1.
# Полная проверка повторяется в database-runtime-build.sh + post-build verify.
# ═════════════════════════════════════════════════════════════════════════════
echo "🛡  Deploy guard (pre-flight): fresh sync marker + целостность runtime-зоны…"
if [ "${RUNTIME_BOOTSTRAP_EMPTY:-}" != "1" ] && [ ! -f "$RUNTIME_ZONE/.live-sync.json" ]; then
    echo "❌ НЕТ fresh sync маркера $RUNTIME_ZONE/.live-sync.json после final sync — ошибка пайплайна." >&2
    exit 1
fi
if [ "${RUNTIME_BOOTSTRAP_EMPTY:-}" != "1" ]; then
    bun scripts/check-deploy-freshness.mjs "$RUNTIME_ZONE" || exit 1
fi

BUILD_DIR="/tmp/build_fullstack_$BUILD_ID"
echo "📁 清理并创建构建目录: $BUILD_DIR"
mkdir -p "$BUILD_DIR"

# 安装依赖
echo "📦 安装依赖..."
bun install

# 构建 Next.js 应用
echo "🔨 构建 Next.js 应用..."
bun run build

# 校验 standalone 服务端入口是否生成（部署成功率守卫）。
# Next 仅在 next.config 含 output:"standalone" 时产出 .next/standalone/server.js。
# 若用户/AI 编辑项目时改写或删除了该配置，bun run build 仍会成功（static 照常
# 产出、退出码 0），但 standalone 缺失——打出的包里没有 server.js，部署到 FC 后
# start.sh 找不到 next-service-dist/server.js → 不启动 Next → Caddy:81 反代空的
# 3000 → FC 健康检查 120s 超时失败（线上 warmup_412 / FunctionNotStarted 的主因）。
# 这里做一次自愈：仅在确实缺失时，给 next.config 补回 output:"standalone" 并重建。
# 正常项目（已生成 server.js）整段跳过，不读写任何用户文件。
if [ ! -f ".next/standalone/server.js" ]; then
    echo "⚠️  构建未产出 .next/standalone/server.js，开始自愈 next.config 的 output 配置..."
    NEXT_CONFIG_FILE="$(ls next.config.ts next.config.js next.config.mjs next.config.cjs 2>/dev/null | head -1)"

    if [ -z "$NEXT_CONFIG_FILE" ]; then
        echo "❌ 构建失败：未找到 next.config.*，无法生成 standalone 部署产物。"
        exit 1
    fi

    if grep -Eq "output\s*:\s*['\"]standalone['\"]" "$NEXT_CONFIG_FILE"; then
        # 已声明 standalone 却仍没产出 server.js，说明不是配置缺失（可能 build 真
        # 出错、自定义 distDir 等）。不臆改用户配置，直接失败并暴露原因。
        echo "❌ 构建失败：$NEXT_CONFIG_FILE 已含 output:\"standalone\"，但仍未生成 .next/standalone/server.js。"
        echo "   请检查上方构建日志中的报错或项目自定义的构建配置。"
        exit 1
    fi

    if grep -Eq "output\s*:\s*['\"]" "$NEXT_CONFIG_FILE"; then
        # 已显式声明了其它 output（如 "export" 静态导出 / "standalone" 之外的值）。
        # "export" 与本部署模型（standalone + 自定义 server）互斥——不能注入第二个
        # output 覆盖用户意图（JS 对象重复 key 后者生效，注入也无效）。明确失败。
        echo "❌ 构建失败：$NEXT_CONFIG_FILE 已声明非 standalone 的 output（如 \"export\" 静态导出），与当前部署模型不兼容。"
        echo "   当前部署需要 output:\"standalone\"。请改为 standalone，或确认该项目是否应走静态托管而非部署沙箱。"
        exit 1
    fi

    echo "🔧 检测到 $NEXT_CONFIG_FILE 缺少 output:\"standalone\"，自动注入后重新构建..."
    cp "$NEXT_CONFIG_FILE" "${NEXT_CONFIG_FILE}.zbak"
    # 在第一个配置对象字面量起始的 { 之后插入 output:"standalone"，
    # 覆盖脚手架常见写法：const nextConfig...= {  /  export default {  /  module.exports = {
    perl -0pi -e 's/((?:const\s+\w+[^=]*=|export\s+default|module\.exports\s*=)\s*\{)/$1\n  output: "standalone",/' "$NEXT_CONFIG_FILE"

    if ! grep -Eq "output\s*:\s*['\"]standalone['\"]" "$NEXT_CONFIG_FILE"; then
        echo "❌ 未能匹配到可注入的配置对象，next.config 写法非常规，需人工添加 output:\"standalone\"。"
        echo "   当前 $NEXT_CONFIG_FILE 内容："
        cat "$NEXT_CONFIG_FILE"
        mv "${NEXT_CONFIG_FILE}.zbak" "$NEXT_CONFIG_FILE"
        exit 1
    fi

    echo "🔨 已注入 output:\"standalone\"，重新构建..."
    bun run build

    if [ ! -f ".next/standalone/server.js" ]; then
        echo "❌ 注入 output:\"standalone\" 并重建后，仍未生成 .next/standalone/server.js。"
        exit 1
    fi
    echo "✅ 自愈成功：standalone 服务端入口已生成。"
fi

# 构建 mini-services
# 检查 Next.js 项目目录下是否有 mini-services 目录
if [ -d "$NEXTJS_PROJECT_DIR/mini-services" ]; then
    echo "🔨 构建 mini-services..."
    # 使用 workspace-agent 目录下的 mini-services 脚本
    sh "$SCRIPT_DIR/mini-services-install.sh"
    sh "$SCRIPT_DIR/mini-services-build.sh"

    # 复制 mini-services-start.sh 到 mini-services-dist 目录
    echo "  - 复制 mini-services-start.sh 到 $BUILD_DIR"
    cp "$SCRIPT_DIR/mini-services-start.sh" "$BUILD_DIR/mini-services-start.sh"
    chmod +x "$BUILD_DIR/mini-services-start.sh"
else
    echo "ℹ️  mini-services 目录不存在，跳过"
fi

# 将所有构建产物复制到临时构建目录
echo "📦 收集构建产物到 $BUILD_DIR..."

# 复制 Next.js standalone 构建输出
if [ -d ".next/standalone" ]; then
    echo "  - 复制 .next/standalone"
    cp -r .next/standalone "$BUILD_DIR/next-service-dist/"
fi

# 复制 Next.js 静态文件
if [ -d ".next/static" ]; then
    echo "  - 复制 .next/static"
    mkdir -p "$BUILD_DIR/next-service-dist/.next"
    cp -r .next/static "$BUILD_DIR/next-service-dist/.next/"
fi

# 复制 public 目录
if [ -d "public" ]; then
    echo "  - 复制 public"
    cp -r public "$BUILD_DIR/next-service-dist/"
fi

# Python 不继承 workspace-agent 的 /home/z/.venv。若项目包含 Python 源码或
# 依赖清单，在构建期将生产依赖固化到产物，并保持 Python 源码的项目相对路径。
PROJECT_DIR="$NEXTJS_PROJECT_DIR" BUILD_DIR="$BUILD_DIR" \
    bash "$SCRIPT_DIR/python-runtime-build.sh"

# 有 Preview 数据库时复制现有数据；没有时直接在部署产物中初始化空库。
# 模板源码不携带 db/custom.db，不能依赖 dev.sh 必须在 Deploy 前成功运行过。
PROJECT_DIR="$NEXTJS_PROJECT_DIR" BUILD_DIR="$BUILD_DIR" \
    bash "$SCRIPT_DIR/database-runtime-build.sh"

# 复制 Caddyfile（如果存在）
if [ -f "Caddyfile" ]; then
    echo "  - 复制 Caddyfile"
    cp Caddyfile "$BUILD_DIR/"
else
    echo "ℹ️  Caddyfile 不存在，跳过"
fi

# 复制 start.sh 脚本
echo "  - 复制 start.sh 到 $BUILD_DIR"
cp "$SCRIPT_DIR/start.sh" "$BUILD_DIR/start.sh"
chmod +x "$BUILD_DIR/start.sh"

# 打包到 $BUILD_DIR.tar.gz
PACKAGE_FILE="${BUILD_DIR}.tar.gz"
echo ""
echo "📦 打包构建产物到 $PACKAGE_FILE..."
cd "$BUILD_DIR" || exit 1
tar -czf "$PACKAGE_FILE" .
cd - > /dev/null || exit 1

# ═════════════════════════════════════════════════════════════════════════════
# CRITICAL STABILITY PART 1.1 §4.3: сборка УСПЕШНА — live ОСТАЁТСЯ LOCKED.
# НЕ СНИМАТЬ lock: он исчезнет вместе со старым контейнером после cutover
# (или истечёт по TTL ~30 мин, если платформа упала после сборки). Снятие
# открыло бы окно, в котором сотрудник грузит фото в СТАРЫЙ контейнер во
# время переключения — ровно тот сценарий потери данных, который мы закрыли.
# ═════════════════════════════════════════════════════════════════════════════
BUILD_SUCCESS=1
if [ "$LOCK_ACQUIRED" = "1" ]; then
    echo "🔒 Сборка успешна — deploy-lock $LOCK_ID ОСТАЁТСЯ на live (до cutover/TTL; НЕ снимаем)"
fi

# # 清理临时目录
# rm -rf "$BUILD_DIR"

echo ""
echo "✅ 构建完成！所有产物已打包到 $PACKAGE_FILE"
echo "📊 打包文件大小:"
ls -lh "$PACKAGE_FILE"
