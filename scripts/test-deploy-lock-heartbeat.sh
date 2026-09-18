#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# test-deploy-lock-heartbeat.sh — механика REV.2 (пп.2–3 отзыва владельца):
#
#   T1. renew_live: подтверждённое продление (ok:true) → код 0
#   T2. renew_live: 409 LOCK_NOT_RENEWABLE (чужой/истёкший) → не 0
#   T3. renew_live: пустой ответ (сеть/404) → не 0 (fail-closed)
#   T4. heartbeat_loop: неудача продления → маркер $HEARTBEAT_STATE/failed
#       + ненулевой код возврата
#   T5. start/stop_heartbeat: фоновый цикл реально продлевает lock (мок
#       получил ≥1 renew) и глушится stop'ом (не переживает скрипт)
#   T6. start_heartbeat без LOCK_ID — no-op (bootstrap без endpoint)
#
# Функции ИЗВЛЕКАЮТСЯ из реального .zscripts/build.sh (sed/awk) — тест
# проверяет ровно тот код, который едет в production; curl заменён моком.
# Запуск: bash scripts/test-deploy-lock-heartbeat.sh
# ─────────────────────────────────────────────────────────────────────────────
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
check() { if [ "$1" = "0" ]; then PASS=$((PASS+1)); echo "  ✓ $2"; else FAIL=$((FAIL+1)); echo "  ✗ $2${3:+ — $3}"; fi }

FUNCS="$(mktemp)"
awk '/^live_lock_api\(\) \{/{f=1} /^cleanup\(\) \{/{f=0} f' .zscripts/build.sh > "$FUNCS"
[ -s "$FUNCS" ]; check $? "T0. функции heartbeat извлечены из .zscripts/build.sh" "пусто — проверь awk-паттерн"
# shellcheck disable=SC1090
source "$FUNCS"

# Общая конфигурация (как выставляет build.sh до вызова функций)
LOCK_ID="test-lock-id"
LOCK_HEARTBEAT_SEC=1
LOCK_RENEW_TTL_SEC=1800
LOCK_FINAL_TTL_SEC=3600
AUTH_ARGS=()
HEARTBEAT_PID=""
HEARTBEAT_STATE=""

RENEW_LOG="$(mktemp)"
MOCK_SCENARIO="ok"
live_lock_api() {
    local payload="$1"
    case "$payload" in
        *'"action":"renew"'*)
            echo "$payload" >> "$RENEW_LOG"
            case "$MOCK_SCENARIO" in
                fail)  echo ""; return 0 ;;                                  # сеть упала
                wrong) echo '{"error":"Deploy-lock отсутствует (истёк/снят) или lockId не совпадает — продлить нельзя.","code":"LOCK_NOT_RENEWABLE"}'; return 0 ;;
                ok)    echo '{"ok":true,"lockId":"test-lock-id","expiresAt":"2030-01-01T00:00:00.000Z"}'; return 0 ;;
            esac
            ;;
        *) echo '{}' ;;
    esac
}

echo "── T1–T3: renew_live"
MOCK_SCENARIO="ok"
renew_live "$LOCK_ID" 1800; check $? "T1. renew ok:true → код 0"
grep -q '"ttlSec":1800' "$RENEW_LOG"; check $? "T1b. ttlSec передан в payload" "$(cat "$RENEW_LOG")"

MOCK_SCENARIO="wrong"
if renew_live "someone-elses-id" 1800; then check 1 "T2. renew чужим lockId → не 0" "вернул 0"; else check 0 "T2. renew чужим lockId → не 0"; fi

MOCK_SCENARIO="fail"
if renew_live "$LOCK_ID" 1800; then check 1 "T3. renew при пустом ответе (сеть) → не 0" "вернул 0"; else check 0 "T3. renew при пустом ответе (сеть) → не 0"; fi

echo "── T4: heartbeat_loop пишет маркер неудачи"
MOCK_SCENARIO="fail"
HEARTBEAT_STATE="$(mktemp -d)"
heartbeat_loop; HB_RC=$?
[ $HB_RC != 0 ] && [ -f "$HEARTBEAT_STATE/failed" ]; check $? "T4. неудача продления → маркер failed + rc≠0" "rc=$HB_RC"
rm -rf "$HEARTBEAT_STATE"

echo "── T5: start/stop_heartbeat (фоновый цикл)"
MOCK_SCENARIO="ok"
: > "$RENEW_LOG"
HEARTBEAT_STATE="$(mktemp -d)"
start_heartbeat
sleep 2.5
stop_heartbeat
N_RENEWS="$(wc -l < "$RENEW_LOG" | tr -d ' ')"
[ "${N_RENEWS:-0}" -ge 1 ]; check $? "T5. фоновый heartbeat продлил lock (renew вызван ${N_RENEWS:-0} раз(а) за ~2.5 c)" "log=$RENEW_LOG"
sleep 1.2
N2="$(wc -l < "$RENEW_LOG" | tr -d ' ')"
[ "$N2" = "$N_RENEWS" ]; check $? "T5b. после stop_heartbeat цикл заглушен (renew не растёт: $N_RENEWS → $N2)"
rm -rf "$HEARTBEAT_STATE"

echo "── T6: start_heartbeat без lock"
LOCK_ID=""
HEARTBEAT_PID=""; HEARTBEAT_STATE=""
start_heartbeat
[ -z "$HEARTBEAT_PID" ] && [ -z "$HEARTBEAT_STATE" ]; check $? "T6. без LOCK_ID start_heartbeat — no-op (bootstrap)"
LOCK_ID="test-lock-id"

rm -f "$RENEW_LOG" "$FUNCS"
echo "═══ deploy-lock-heartbeat: PASS $PASS / FAIL $FAIL ═══"
[ "$FAIL" = "0" ]
