# CRITICAL STABILITY — PART 1.1 HOTFIX: отчёт

Дата: 2026-09-19
Ветка: `main`

START_HEAD: `a573c09ec652a914b3c0634ed424325d01791eb1`
FINAL_HEAD: см. раздел «COMMITS» (финальный коммит `docs` в этой же сессии).

---

## 0. Что было причиной hotfix (ТЗ §0)

Гонка потери runtime-данных при деплое:

```
10:00  sync-from-live          → локальная зона == marker (свежий)
10:05  сотрудник грузит фото   → live меняется, marker всё ещё «свежий»
10:15  build                   → артефакт ЦЕЛ, но БЕЗ фото 10:05
deploy → старый контейнер уничтожен → фото 10:05 снова потеряно
```

«Marker моложе 72 часов» НЕ доказывает актуальность. Нужна атомарная схема:
LOCK LIVE WRITES → WAIT ACTIVE WRITES = 0 → FINAL SYNC → VERIFY → BUILD →
ARTIFACT VERIFY. Она реализована в этом hotfix полностью и закрыта тестами.

---

## 1. DEPLOY LOCK (P0, ТЗ §1–3) — PASS

**Файл `src/lib/runtime-write-lock.ts` (новый):**

* `DeployWriteLock` — файл `RUNTIME_ROOT/.deploy-write-lock.json`, TTL 30 мин
  (истёк/повреждён → считается отсутствующим и удаляется, stale lock не
  висит вечно).
* **Writer lease** — `RUNTIME_ROOT/.runtime-writers/<uuid>.json`. Схема
  «check lock → lease → RE-check lock → mutation → finally release»
  закрывает гонку «upload начал запись до lock, завершится после snapshot».
* Атомарность создания lock: tmp-файл + `link()` (гонка двух acquirer'ов —
  выигрывает ровно один, второй получает `DeployLockExistsError`).
* Stale lease (crash без finally, > 30 мин) убирается уборщиком и не
  блокирует drain.
* `runtimeLockedResponse()` — единый ответ 423 с
  `Retry-After: 60`, `Cache-Control: no-store` и понятным текстом
  («Идёт обновление приложения…»), без «Ошибки сервера».
* Lock/lease-файлы НЕ попадают в артефакт: `database-runtime-build.sh`
  копирует в артефакт только `db/`, `uploads/` и `.sync-token`.

## 2. LOCK ALL RUNTIME MUTATIONS (P0, ТЗ §2) — PASS

Аудит `src/app/api/**/route.ts` (grep по create/update/delete/upsert/
createMany/deleteMany/updateMany/writeFile/unlink/$executeRaw/INSERT/UPDATE):

| Маршрут | Мутации | Обработка |
|---|---|---|
| `POST /api/upload` | файлы + БД | writer-lease `beginRuntimeWrite("upload")` ДО `req.formData()`; под lock — 423 |
| `POST /api/fabric-photo` | optimized/thumb + Material | writer-lease `fabric-photo`; под lock — 423 |
| `POST /api/admin` | все admin-action (create/rename/delete/restore/purgePhoto/purgeTrash/movePhoto/quickCreateVariant/…) | ВЕСЬ POST под ОДНИМ lease (не каждая action отдельно); под lock — 423 |
| `DELETE /api/admin?photoId` | мягкое удаление → корзина | writer-lease (найдено аудитом, ТЗ §2) |
| `GET /api/admin?view=trash` | `autoPurgeTrash()` физически удаляет данные | Под lock `autoPurge` ПРОПУСКАЕТСЯ (`lock ? 0 : await autoPurgeTrash()`): GET отдаёт данные, ничего не удаляя (ТЗ §2.4). Поведение вне lock не изменено |
| catalog / dictionaries / media / search / stock / `GET export` | мутаций НЕТ (аудит; export делает `VACUUM INTO` во временный файл вне runtime) | без lock-логики — экспорт обязан работать ПОД lock для final sync |

## 3. DEPLOY LOCK API (P0, ТЗ §3) — PASS

**`src/app/api/admin/deploy-lock/route.ts` (новый)**, защищён ТЕМ ЖЕ токеном,
что `/api/admin/export`:

* **Auth вынесен** в `src/lib/sync-auth.ts` (`expectedSyncToken` /
  `isSyncAuthorized`) — `crypto.timingSafeEqual` вместо `===` (разные длины
  тоже сравниваются, чтобы профиль времени не выдавал длину секрета).
  Оба endpoint'а используют один helper; без токена — 401 fail-closed.
* `POST {action:"lock", ttlSec, owner}` → атомарное создание →
  `waitForRuntimeWriters(120s)` → не дождались → lock СНЯТ + 503
  `WRITERS_BUSY` → дождались → `{ok, lockId, expiresAt, activeWriters:0}`.
  Чужой lock уже стоит → 409 `ALREADY_LOCKED`.
* `POST {action:"unlock", lockId}` — снимается ТОЛЬКО совпадающий id
  (чужой → 409 `LOCK_ID_MISMATCH`).
* `GET` → `{locked, lock, activeWriters}` (token-protected).

## 4. AUTO FINAL SYNC В BUILD (P0, ТЗ §4) — PASS

**`.zscripts/build.sh`** переработан: пользователь больше не помнит про
ручной sync. Production-схема:

```
[deps install без lock]
→ ACQUIRE LIVE LOCK (POST /api/admin/deploy-lock, ttlSec 1800, owner build)
→ WAIT ACTIVE WRITES = 0 (сервер делает drain сам)
→ FINAL SYNC FROM LOCKED LIVE (scripts/sync-from-live.sh + DEPLOY_LOCK_ID)
→ VERIFY CURRENT DEPLOY LOCK ID (GET status: lock всё ещё наш; иначе FAIL)
→ deploy-guard (marker + lockId)
→ BUILD → ARTIFACT VERIFY (database-runtime-build.sh: guard + verify)
```

* **Shell trap (§4.4):** `LOCK_ACQUIRED` / `BUILD_SUCCESS` / `LOCK_ID`;
  `cleanup()` снимает lock ТОЛЬКО если сборка не удалась (EXIT/INT/TERM).
* **Lock lifetime (§4.3):** BUILD FAILED → unlock сразу; BUILD SUCCESS →
  live ОСТАЁТСЯ LOCKED — lock исчезнет со старым контейнером при cutover
  или истечёт по TTL (~30 мин), если платформа упала после сборки.
* **LIVE_BASE_URL (§4.2):** единый config `.zscripts/deploy.env`
  (`https://j1jr777qg2d0-d.space-z.ai`), приоритет env > файл > ничего.
  Не секрет.
* **FIRST_DEPLOY_LOCK_BOOTSTRAP=1 (§11):** одноразовый переход. Красное
  предупреждение (ANSI-red), lock пробуется мягко (endpoint может
  отсутствовать), final sync максимально поздний, требуется ручной
  maintenance window (запрет загрузок). После первого успешного деплоя
  обычная сборка БЕЗ deploy-lock УПАДАЕТ (fail-closed, проверено
  негативной веткой: нет lockId → ❌ сборка заблокирована).
* `RUNTIME_BOOTSTRAP_EMPTY=1` — чистая установка: live-операции пропускаются
  (тот же контракт, что у deploy-guard и `src/lib/runtime.ts`).
* `DEPLOY_LOCK_ID` экспортируется вниз по пайплайну — guard
  `database-runtime-build.sh` тоже требует привязку маркера к ТЕКУЩЕМУ lock.

## 5. MARKER ↔ LOCK (P0, ТЗ §5) + FINGERPRINTS FAIL-CLOSED (§6–7) — PASS

* **`scripts/sync-from-live.sh`:** пишет `"lockId"` в `.live-sync.json`
  (из `DEPLOY_LOCK_ID`); без lock — пустое поле, такой маркер деплой под
  lock НЕ примет. Шаги синка перенумерованы: [5/6] — верификация A/B.
* **`scripts/check-deploy-freshness.mjs`:**
  * `marker.lockId === process.env.DEPLOY_LOCK_ID` — иначе **DEPLOY
    BLOCKED** (нет lockId / чужой lockId → BLOCK);
  * **dbSha mismatch → FAIL** (было `console.warn` — ТЗ §6: заменено на
    fail-closed; «runtime DB изменилась после final sync»);
  * 72-часовая свежесть при заданном `DEPLOY_LOCK_ID` — только
    ДИАГНОСТИКА (warn, §5.2: production truth = lockId-привязка); в ручном
    режиме (без lock) осталась fail-closed как прежде.
* **Манифест A/B (§7):** sync скачивает манифест B перед атомарной заменой
  и сравнивает fingerprint `{db counts; optimized:[name,bytes,sha256];
  thumbs:[...]}` (generatedAt/runtimeRoot исключены). A ≠ B →
  «LOCK BYPASS / RACE» → EXIT 1, локальная зона НЕ тронута.
* **Попутный фикс корректности (необходим для auto-sync):** манифест
  `/api/admin/export` теперь считает `photos` как ЖИВЫЕ фото
  (`deletedAt: null`) — ровно ту метрику, которую сверяет sync со
  скачанной БД. Раньше count() включал корзину: при любом непустом trash
  auto-sync падал бы «расхождение счётчиков».

## 6. SYNC TOKEN БЕЗ САМОРОТАЦИИ (P0, ТЗ §8) — PASS

Приоритет источника токена (build.sh и sync-from-live.sh):

1. `env SYNC_EXPORT_TOKEN`;
2. существующий `RUNTIME_ROOT/.sync-token`;
3. иначе — **ОТКАЗ** (автогенерация запрещена: случайный токен live не
   знает → 401; молчаливая генерация маскировала бы ошибку).

**Первый bootstrap (§8.1)** — только ЯВНО: `SYNC_TOKEN_BOOTSTRAP=1` или
флаг `--bootstrap-token`. После первого защищённого деплоя автогенерация
запрещена.

**Token backup (§8.2):** токен хранится в `download/runtime/.sync-token`
(вне Git) и ПЕЧЁТСЯ В АРТЕФАКТ тем же пайплайном (сервер читает тот же
файл). Предпочтительное место резервной копии — platform secret /
environment; если платформа не поддерживает секреты — владелец обязан
сохранить токен вне Git. НИКОГДА не коммитить.

## 7. SYMLINK HARDENING (P1, ТЗ §9) — PASS

`scripts/verify-runtime-artifact.mjs` (+ `countFiles` в
`check-deploy-freshness.mjs`):

* `lstatSync()` вместо `statSync()`: сам symlink → FAIL («SYMLINK
  запрещён (data-integrity)») — раньше statSync следовал по ссылке, и
  `uploads/optimized/foo.jpg → /etc/passwd` прошёл бы как regular file;
* `realpathSync(файл)` обязан лежать внутри `realpathSync(ROOT)` —
  symlink-побег наружу невозможен;
* `countFiles` не считает symlink обычным media-файлом (нет ложных
  срабатываний счётчиков на сиротах-ссылках).

## 8. FRONT FIX №1 — ЛИНЗА БЕЗ БЕЛОГО ПРОЖЕКТОРА (ТЗ §12) — PASS

`src/app/globals.css`:

* `.pill-bubble`: **новый материал** — `rgba(var(--brand-rgb), 0.035)` +
  `inset 0 0 0 1px rgba(var(--brand-rgb), 0.16)`. УДАЛЕНЫ: белый top-edge
  inset (0.32), белый radial (0.06), linear white stops, кольцо 0.12.
  Наружных теней НЕТ.
* `.pill-bubble::after { display: none; }` — белый radial-спекуляр
  отключён полностью (`--lens-press`/`--lens-bridge` по-прежнему ставятся
  gesture-контроллером; press-фидбек остался геометрическим: spring
  scaleY + covered-content scale).
* `.light .pill-bubble`: `rgba(var(--brand-rgb), 0.025)` + 1px inset
  граница 0.14. УДАЛЕНЫ: белый radial 0.72, белый top-edge 0.95,
  наружная тень `0 4px 14px`, белое гало `0 0 0 2.5px` — ровно то, что
  ТЗ запретило.
* `.pill-surface::before` (sheen): 0.55 → **0.10 на мобильном** (≤0.12 по
  ТЗ §12.2), 0.30 на desktop (≥1024px) — панель читается кромкой и
  контентом.
* `.pill-caustic`: 0.22 → 0.14 (максимально сдержанные; никакого ореола
  на фотографии).
* Android fallback (`html.glass-fallback`) не изменён (turquoise-линза
  как была); панель светлой темы (`.light .pill-surface`) не изменена —
  ТЗ §12 касается только линзы.

## 9. FRONT FIX №2 — БРАУЗЕРНАЯ ПАНЕЛЬ (ТЗ §13) — CODE PASS

* **`src/lib/use-visual-viewport.ts`:** добавлена отдельная метрика
  `visualBottomInset = max(0, innerHeight − (vv.offsetTop + vv.height))`
  (§13.1) — это НЕ keyboardOverlay. Обновление CSS-переменной
  `--browser-bottom-inset` — ТОЛЬКО при `html.is-browser`, НЕ
  standalone-PWA и НЕ kb-open (§13.2). rAF-батчинг, epsilon 1.5px,
  clamp 160px, запись напрямую в CSS variable без React setState (§13.3).
* **CSS:** `html.is-browser:not(.kb-open) .pill-nav { bottom: calc(max(10px, var(--sab)) + var(--browser-bottom-inset, 0px)); }`
* **`?viewportDebug=1`:** добавлены поля `visualBottomInset` и
  `--browser-bottom-inset` (§13.4: документирование реальных метрик на
  устройстве).
* ⚠ **REAL DEVICE REQUIRED:** если на реальном Safari fixed уже привязан
  к visual viewport и офсет задваивается — заменить сложение на
  counter-transform (механика и метрики для этого готовы). Headless-тесты
  проверяют только правило и механику (правило существует; inset=40px
  сдвигает панель ровно на 40px; inset=0 возвращает на место).

## 10. FRONT FIX №3 — UPLOAD SHEET И КЛАВИАТУРА (ТЗ §14) — CODE PASS

`src/components/upload-sheet.tsx` (mobile-ветка):

* **Якорь:** sheet стоит на `bottom: 0` (было `bottom: var(--kb-overlay)`
  — физический подъём ВЕСЬ sheet'а). Высота
  `min(86dvh, calc(100dvh − max(18px,var(--sat)) − 10px))` в закрытом
  состоянии и НЕ зависит от клавиатуры → **header не прыгает**.
* **Клавиатура (§14.2):** НЕ двигает sheet. Внутренний body получает
  `padding-bottom: calc(16px + var(--sab) + var(--kb-overlay))` (плавный
  переход 220 мс) — контент скроллится над клавиатурой; sticky CTA-футеры
  всех шагов стоят на `bottom: var(--kb-overlay)` — поднимаются НАД
  клавиатурой; focused field подводится `scrollIntoView` (320 мс — iOS
  сначала поднимает клавиатуру).
* Android (resizes-content): `--kb-overlay ≈ 0`, dvh сжимается сам — та же
  формула совпадает.
* ⚠ **REAL IOS REQUIRED:** headless проверяет layout-контракт (механика
  клавиатуры эмулируется установкой `--kb-overlay`), реальное поведение
  iOS — по чек-листу владельца.

## 11. ТЕСТЫ (ТЗ §10, §16) — PASS

**Новый `scripts/test-live-sync-race.sh`** — production-flow в изоляции
(standalone-сервер + изолированная runtime-зона; production md5-снимок
до/после — не тронут). **38 PASS / 0 FAIL**:

* A. live-фикстура: 26 живых фото + 1 в корзине (40 дней) + токен; манифест
  считает живые (корзина не попадает в photoCount);
* B. §10.1 IN-FLIGHT WRITE DRAIN: реальный `beginRuntimeWrite` держит lease
  (`scripts/lease-holder.ts`) → deploy-lock ЖДЁТ (спустя 1.2 c ответа ещё
  нет) → release → lock ok, `activeWriters:0`, время ожидания ≥ 1 c;
* C. под lock: upload → **423 DEPLOY_LOCKED**, fabric-photo → 423, admin
  POST → 423, admin DELETE → 423; photo count не изменился; новых media
  файлов нет; `GET view=trash` → 200, `autoPurged=0`, trash-фото и файлы
  физически на месте (§2.4);
* D. §10.3 FINAL SYNC под lock (`DEPLOY_LOCK_ID`) → маркер привязан
  (`marker.lockId == lockId`), локальная зона = данным live;
* E/F. §10.3 ARTIFACT BUILD из зоны, синхронизированной под lock
  (`database-runtime-build.sh` c `DEPLOY_LOCK_ID`-guard) + post-build
  `ARTIFACT VERIFY: PASS` + повторный verify;
* G. unlock СВОИМ lockId → upload снова 200 (uploaded:1);
* H. §10.2 marker race: wrong lockId → BLOCK; dbSha mismatch (инсерт
  после sync) → BLOCK; нет маркера → BLOCK; нет БД → BLOCK; битый
  Photo-файл → BLOCK; контроль: валидная зона + верный lockId → PASS;
* I. §7 манифест A/B: «live изменился во время синка» (fake-live сервер
  отдаёт разные манифесты A и B) → sync FAIL («LOCK BYPASS»), приёмник
  НЕ заменён (маркера нет);
* J. §9 symlink: symlink вместо media-файла → verify FAIL с причиной
  «SYMLINK запрещён»; сирота-symlink не считается media-файлом (нет
  ложного FAIL), счётчик optimized=27 без искажений.

**Новый `scripts/test-part11-front.mjs`** (`verify:part11`) — 22 PASS / 0
FAIL: материал линзы (тинт/граница/::after off/без внешних теней и гало в
обеих темах), sheen ≤0.12 mobile / 0.30 desktop, каустики ≤0.2; правило
`is-browser:not(.kb-open) .pill-nav` + механика inset (0→10px, 40→50px,
возврат); upload sheet: якорь bottom:0, gap=0, 86dvh, при «клавиатуре»
sheet не двигается, header не прыгает, body pad 316px, sticky CTA на
300px.

**Обновлён контракт 16c в `scripts/test-mobile-nav-search.mjs`** под новое
поведение §14 (старый ассерт «низ sheet = kb-overlay» противоречил новому
ТЗ): sheet не двигается, pad=316, CTA=300.

**Регрессия (всё зелёное):**

| Suite | Результат |
|---|---|
| TYPECHECK (`tsc --noEmit`) | PASS |
| LINT (`eslint .`) | PASS |
| BUILD (`bun run build` + standalone) | PASS |
| `verify:data` (deploy-cycle 2 цикла) | 22/0 |
| `verify:race` (live-sync-race, НОВЫЙ) | 38/0 |
| `verify:part11` (front-контракты, НОВЫЙ) | 22/0 |
| nav-search E2E | 110/0 |
| horizontal-nav E2E | 125/0 |
| v31 (viewer) | 22/0 |
| themes | 33/0 |
| stability-part1 (Android fallback/viewport/sheet) | 66/0 |
| regression-photo-persistence | 17/0 |
| restore-roundtrip | 13/0 |

## 12. LOST PHOTOS (~20, ТЗ §20)

Не делается redeploy в этой сессии (по ТЗ). Про потерянные ~20 фото:
**в доступных источниках (workspace, Git, бэкапы) не обнаружены; platform
snapshot (старый container / old deploy filesystem / persistent disk
snapshot) ещё не проверен.** Владельцу: до любого redeploy запросить у
платформы snapshot старого контейнера — это единственный возможный
источник.

## 13. КАК ДЕПЛОИТЬСЯ ТЕПЕРЬ (для владельца)

1. **Первый деплой этого кода (live ещё без deploy-lock API):**
   `FIRST_DEPLOY_LOCK_BOOTSTRAP=1` в окружении сборки + ручной
   maintenance window (не грузить фото ~10–15 минут). Один раз.
2. **Все последующие:** обычная сборка. Build сам: lock → drain → final
   sync → verify → build → artifact verify. Если сборка не удалась — lock
   снимется сам; если удалась — live остаётся залоченным до переключения
   контейнера (TTL 30 мин как предохранитель).
3. Токен: `SYNC_EXPORT_TOKEN` в platform secret, либо существующий
   `download/runtime/.sync-token` (уже печётся в артефакт). Backup — вне
   Git.

## 14. REAL DEVICE REQUIRED (ТЗ §17 — не выдавать headless за телефон)

* REAL IPHONE: NOT TESTED — клавиатура в upload sheet (anchor/pad/CTA),
  браузерная компенсация тулбара (`?viewportDebug=1`:
  `visualBottomInset`, `--browser-bottom-inset`; при задвоении офсета —
  переход на counter-transform, механика готова).
* REAL XIAOMI: NOT TESTED — fallback-линза не менялась (expected: без
  регрессий).
* Browser toolbar / haptics: REAL DEVICE REQUIRED.

## 15. COMMITS

См. историю git: поэтапные коммиты по смыслу (atomic deploy lock →
auto-sync locked live → fail-closed fingerprints → symlink hardening →
lens highlight → browser panel → upload sheet keyboard → race tests →
docs). Никаких `reset --hard` / `clean -fd` / `add .` / `add -A`.

## 16. OPEN ISSUES

1. Platform snapshot для ~20 фото — вне досягаемости workspace, не
   проверен (см. §12).
2. Real-device проверки (§14) — чек-лист владельца.
3. `middleware` deprecation warning от Next (косметика, вне скоупа).
4. GET `view=trash` под lock возвращает данные без автоочистки —
   автоочистка догоняет при первом обращении после снятия lock; полное
   устранение purge из GET — будущее улучшение (ТЗ §2.4), поведение не
   ломалось.
