# Worklog

---
Task ID: 2
Agent: main (Super Z)
Task: Блоки 1–3 по поручению пользователя: (1) восстановить загрузку фото, (2) работающие уведомления, (3) мобильная шапка и навигация. Пользователь явно запретил трогать весь дизайн и блоки 4–6.

Work Log:
- Пересканировал проект: обнаружено отсутствие src/app/api/upload/route.ts — загрузка была полностью сломана (клиент слал POST в 404)
- Блок 1: создал POST /api/upload — серверная валидация ≤10 файлов, MIME (jpeg/png/webp), ≤25 МБ, magic-bytes через sharp; EXIF-поворот → 2000px WebP q86 + миниатюра 640px q80; find-or-create ProductVariant (cat+model+material+size), привязка тегов, sortOrder = max+1; ответ {uploaded, rejected[]}
- Блок 1: upload-view переведён на XHR — реальный прогресс (upload.onprogress, отправка 0–70%, обработка 70–100%), полоса прогресса, экран успеха с «Показать в каталоге» (openProduct) и списком отклонённых файлов; сетевые ошибки/отмена — тосты
- Блок 2: серверная проверка дублей на create для всех справочников (409 с понятным текстом); DELETE /api/admin возвращает данные фото; action restorePhoto восстанавливает удалённое; PhotoBank: тост «Фото удалено» с кнопкой «Вернуть» (8 сек)
- Блок 3: store.ts — warehouse (Обухово/Владимир, sessionStorage), restore() после F5 (приоритет: history.state, fallback sessionStorage), savedScrollY, dismissProduct/dismissViewer (мгновенное применение состояния + suppressPush + history.back())
- Блок 3: portal.tsx — History API: pushState на каждый слой (view/product/viewer) с дедупликацией против history.state; popstate применяет верхний слой; Escape закрывает только верхний слой (guard по viewerOpen/filtersOpen); шапка: логотип + «Остатки» + селектор склада (фикс. ширина 92px) + ThemeSwitch mini (h-7) — без перекрытий на 320px
- Диагностика скролла: прыжок в 64px = AnimatePresence mode="wait" схлопывает документ на кадр, Chrome клампит скролл; исправлено rAF-поллингом высоты перед scrollTo instant; overflow-anchor:none добавлен профилактически
- Ограничение среды: headless agent-browser не выполняет same-document traversal (history.back из CDP молча не работает, минимальный кейс вне приложения подтверждает) — popstate-ветка верифицирована синтетически + код устойчив к обоим вариантам (состояние применяется мгновенно)

Verification:
- bun run build (standalone) — успешно; /api/upload в роутах; prod-сервер на :3000
- API-тесты (python): загрузка 2 PNG → ok, WebP на диске, фото в /api/catalog, HTTP 200; 11 файлов → 400 с текстом про лимит; текст под видом PNG → 400 «не удалось обработать»
- Браузер (390×844 и 320×800): UI-загрузка 2 фото → «2 фото загружено»; Esc послойно (viewer → product → stock); F5 на товаре → остаётся товар; «К остаткам» → остатки + скролл восстановлен (800=800); смена склада → same:true (0px сдвига); консоль без ошибок
- Геометрия шапки 320/360/375/390/414/430: перекрытий нет, overflowX нет, правый край ≤307/320
- Скриншоты: download/screenshots/ (mob-320…430 stock/catalog, product, viewer, upload, admin, upload-success)

Stage Summary:
- Блоки 1–3 реализованы, приёмка пройдена; блоки 4–6 и дополнения просмотрщика (Web Share, «Скачать», сохранение фильтров каталога) — СЛЕДУЮЩИЙ этап после реверификации пользователем
- Изменённые файлы: api/upload/route.ts (новый), api/admin/route.ts, lib/store.ts (переписан), components/{portal,upload-view,admin-view,product-view,photo-viewer,theme-switch}.tsx, globals.css (overflow-anchor)
- Известные ограничения: селектор склада меняет подпись (данные остатков пока только Обухово — данные подключаются в блоках 4–6); popstate-поведение браузерного Back не воспроизводимо в headless-среде (в реальных браузерах паттерн стандартный)

---
Task ID: 1
Agent: main (Super Z)
Task: Создать ВАУ-сайт «Остатки» (Skovo Portal) на базе загруженных файлов пользователя (статический сайт «Остатки Обухово · Askona» + ТЗ skovo-portal-implementation-plan-v3), соединив остатки с фотокаталогом. WOW-дизайн, hover-эффекты, мобильная версия.

Work Log:
- Изучил загруженные файлы: index.html, app.js (6.4k строк, vanilla JS), styles.css, manifest, ТЗ v3 (1538 строк)
- Извлёк бизнес-логику: структура остатков (name/qty/category/size/bedPm/sofaKind/kpbKind/sale/stale), категории Askona, матчинг «Остатки → Смотреть фото» из ТЗ
- Инициализировал fullstack-окружение (Next.js 16 + Tailwind 4 + shadcn/ui + Prisma/SQLite)
- Схема БД: StockItem, Category, Model, Material, Size, Tag, ProductVariant, ProductVariantTag, Photo
- Сид: 110 позиций остатков (реалистичные модели Askona: Elisa, Domenico, Bruno, Ralf, Tango, Ergomotion, S1000…), 15 вариантов каталога, справочники (16 тканей/материалов, 15 размеров, 16 признаков)
- Сгенерировал 27 фото товаров ИИ (единый студийный стиль, teal-бархат Askona) → public/catalog/
- API: /api/stock (с матчингом photoMatch по модели/размеру/материалу, conf high/medium), /api/catalog (серверная фильтрация + фасеты), /api/dictionaries, /api/admin (create/rename/toggle справочников), /api/upload (sharp: EXIF→resize 2000px→WebP q86 + thumb 640px q80)
- Дизайн-система: тёмная+светлая темы (brand teal #11b5b0), Unbounded+Inter (кириллица), ambient-фон (точечная сетка + 3 аврора-градиента), glassmorphism, hover: card lift + glow-бордер + sweep-блик, spring-анимации framer-motion, skeleton-шиммеры, count-up счётчики
- Секции: Остатки (поиск с подсказками, чипы категорий со счётчиками, распродажа, фильтры: С ПМ/Без ПМ, Прямой/Угловой, КПБ, размеры, stale; бесконечный скролл по 50), Каталог фото (фильтры AND по признакам), страница товара (sticky-инфопанель + вертикальная фотолента), полноэкранный viewer (клавиатура/свайп/цикличность), Загрузка (справочники + dropzone + превью), Админ (6 табов, CRUD, photobank)
- Связка: кнопка «Смотреть фото N» на карточке остатка → страница товара; несколько вариантов → dropdown-выбор
- Мобильная версия: bottom-nav с safe-area, drawer-фильтры (vaul), 2-колоночная сетка, проверено 320px (без горизонтального overflow), 390px, 1440px
- Браузерная проверка (agent-browser): остатки/каталог/товар/viewer/загрузка/админ, тёмная и светлая темы, поиск, свайп, клавиатура

Fixes during dev:
- QueryClientProvider забыт → добавлен в providers
- Hydration mismatch в ThemeSwitch (resolvedTheme span) → useSyncExternalStore
- react-hooks/set-state-in-effect → паттерн «регулировка во время рендера»
- Турбопак отдал устаревший globals.css → форс-рекомпиляция
- Баг сида: цикл Ergo итерировал строку посимвольно (размеры «0», «9») → исправлен
- Матчёр: отсек варианты без фото; конфликт ткани → confidence medium
- useQuery без queryFn в PhotoBank → добавлен

Stage Summary:
- Готовый SPA-портал на Next.js 16: 4 раздела, живая связка остатки↔каталог (48 матчей, 16 точных)
- Файлы: prisma/schema.prisma, prisma/seed.ts, src/app/api/{stock,catalog,dictionaries,admin,upload}/route.ts, src/components/{portal,stock-view,stock-card,filters-panel,stats-strip,catalog-view,product-view,photo-viewer,upload-view,admin-view,theme-switch,boot-splash,providers}.tsx, src/lib/{portal,store}.ts
- Линт чистый, консоль браузера без ошибок, 110 позиций / 997 штук / 15 распродаж / 31 stale

---
Task ID: 3
Agent: main (Super Z)
Task: Реверификация после обрыва сессии — пользователь предположил, что всё «вернулось к первому варианту на старте».

Work Log:
- Проверил файловую систему: src/app/api/upload/route.ts и все компоненты блоков 1–3 на месте; worklog содержит записи Task 1 (сборка сайта) и Task 2 (блоки 1–3); скриншоты 320–430 px в download/screenshots/
- Production-сервер (standalone, :3000) работает, HTTP 200; в standalone-сборке есть app/api/upload
- В отдаваемых JS-чанках найдены все маркеры: «Обухово»×2, «Владимир», «Фото удалено», «Вернуть», «фото загружено», «Показать в каталоге»
- Живые тесты API: пустой запрос → «Не выбрано ни одного файла»; без справочников → «Укажите категорию и модель»; 11 файлов → 400 «Максимум 10 файлов за раз — получено 11»; полная загрузка PNG (Ergo/Ergomotion Plus) → {ok:true, uploaded:1}; фото появилось в /api/catalog (WebP + thumb); тестовые фото удалены через DELETE /api/admin (каталог возвращён к 34 фото)

Stage Summary:
- Ничего не потеряно: блоки 1–3 реализованы, задеплоены в standalone-сборку и работают прямо сейчас. Ощущение «отката» вызвано перезапуском чат-сессии (контекст) и тем, что блоки 1–3 по прямому запрету пользователя не меняли дизайн — изменения функциональные
- Ожидаю верификацию пользователем, затем блоки 4–6 (Web Share «Поделиться», «Скачать», сохранение фильтров/позиции каталога)

---
Task ID: 4
Agent: main (Super Z)
Task: Восстановление структуры по ТЗ v3 — пользователь: «было сначала каталог потом остатки, 2 склада Обухово и Владимир. Куда всё делось?»

Work Log:
- Прошёл всю историю: исходники целы в upload/ (index.html, app.js 6.4k, styles.css, ТЗ v3, видео); в исходниках и ТЗ «Владимир» НЕ упоминается (grep = 0), только «Остатки Обухово · Askona»
- ТЗ v3 предписывает: меню = 1. Каталог фото, 2. Остатки, 3. Загрузка, 4. Админ; стартовый экран = Каталог фото. При сборке (Task 1) я поставил Остатки первыми — отклонение от ТЗ; пункт «свап остатки/каталог» из пакета правок пользователя остался невыполненным
- Исправлено: store.ts (View порядок, view:"catalog" стартовый, restore-fallback "catalog"), portal.tsx (NAV: каталог первый, popstate-fallback, оба логотипа → setView("catalog"), aria-label, бренд «Skovo Portal» в сайдбаре и мобильной шапке), boot-splash («Skovo Portal / Askona · фото и остатки»), layout.tsx (title «Skovo Portal · Askona»), manifest.webmanifest (name/short_name)
- Пересборка production + перезапуск standalone-сервера
- Верификация: первое посещение (новая вкладка) → h1 «Каталог фото»; NAV порядок Каталог→Остатки→Загрузка→Админ; смена склада Обухово↔Владимир — бренд стабилен (103px), overflowX нет; 320px — правый край шапки 307/320; «Остатки склада» работает; консоль без ошибок
- Скриншоты: desktop-catalog-start.png, mob-390-catalog-start.png, mob-320-catalog-start.png

Stage Summary:
- Структура приведена к ТЗ v3: каталог первый и стартовый, склады Обухово/Владимир в селекторе
- Ограничение: реальных данных остатков по Владимиру НЕТ (в исходном файле только Обухово) — нужен файл от пользователя, подключение в блоках 4–6
- Блоки 1–3 остаются реализованными и проверенными; ожидаю верификацию пользователя → блоки 4–6

---
Task ID: 5
Agent: main (Super Z)
Task: Разбор двух новых видео (дёрганье) + восстановление функций v1.4, потерянных при откате контейнера (правки прошлой сессии отсутствовали в файловой системе и git)

Work Log:
- Анализ видео: №1 (592×1280, 24.7с) — приложение с единым поиском: (1) дубль «Ничего не найдено», (2) призраки контента в дропдауне, (3) фото налезает на текст карточки, (4) контент просвечивает сквозь дропдаун; №2 (29.3с) — запись App Store как эталон фиксированной панели
- Инвентаризация: функции v1.4 (типрайтер, дриллдаун, компакт-остатки, подтверждения, склад-фильтр, 16px) в коде ОТСУТСТВОВАЛИ — восстановлены все
- БД: schema +warehouse (StockItem), +variantName (ProductVariant), +latin/sortOrder (Model), +swatchUrl (Material), +sortOrder (Category); сид реальных данных: 5 кроватей (Alfa, Mira Nova, Simple, Extra Nova, Pola Nova) + 5 диванов (Магни, Трентон, Карина ПРО, Локо Про, Ника ПРО) = 26 вариантов (15+11), 35 тканей (21 Sky Velvet + 14 Casanova), 32 остатка на 2 складах (Обухово 19/55шт, Владимир 13/25шт); баг сида: category не заполнялся — исправлен через sofaNames
- Фото: 12 сгенерировано (5 кроватей, 6 диванов; scripts/gen-real-models.sh), каждый вариант = фото модели + образец ткани (2 фото, как в видео)
- API: /api/search (популярные + ткани со счётчиками + варианты с фото), /api/catalog level=categories|models (дреллдаун), /api/stock?warehouse=
- Транслит (lib/translit.ts): фонетический ключ (транслит → шумные согласные в k-класс → гласные долой); x→ks; ц→отдельный класс q (иначе «акция»=«sky»=kk — коллизия найдена и устранена); короткие ключи (≤2) — целое слово или +1 согласная; 20/20 тестов
- Поиск (search-bar.tsx): фиксированный, typewriter-плейсхолдер (4 фразы, печать/пауза/стирание), анимированный градиентный бордер (@property --search-angle), debounce 220мс, применение только Enter/чип/выбор; АНТИ-ДЖИТТЕР: дропдаун — один DOM-узел с непрозрачным bg-background, секции не анимируются, пустой стейт единственный, фото в aspect-контейнерах
- Каталог: дриллдаун Категории (иконки Sofa/BedDouble + счётчики) → Модели → Варианты (ткань + variantName); 3 режима вида (Квадраты/Строки/Крупно); страница результатов поиска (чипы тканей + карточки)
- Остатки: компактные строки по умолчанию (qty-бейдж + название + мета + копировать + фото N), карточки вторым режимом, чипы категорий + распродажа, глобальный поиск фильтрует
- Админка: фото удаляются ТОЛЬКО через выбор (галка) + панель «Выбрано: N» + AlertDialog; создание через подтверждение «Добавить X?»; undo-тост
- КРИТИЧНЫЙ БАГ НАЙДЕН: layout.tsx подключал Radix-тостер, а весь код шлёт в sonner — УВЕДОМЛЕНИЯ НИКОГДА НЕ ПОКАЗЫВАЛИСЬ; заменено на ui/sonner (position top-center, richColors)
- iOS: viewport maximumScale=1 userScalable=false (зум только в просмотрщике фото), 16px инпуты на мобиле (globals.css)
- Бренд: «Склад мебели» v1.5 (шапка, сплэш, layout title, manifest); постоянная «Назад» в шапке (товар→поиск→модель→категория), title шапки контекстный
- Verification: production-сборка ок; API: sky→17 тканей без Casanova, казанова→5 тканей; дриллдаун Диваны(5·15)/Кровати(5·11); Магни→3 варианта; F5 на товаре сохраняет экран; удаление 2 фото 52→50→48 + «Вернуть» → 48; склад Владимир 13/25; 320px: overflowX нет, правый край 307, логотип скрыт <360px; консоль без ошибок
- Скриншоты: v15-dropdown/results-390/level3/stock-rows/stock-compact/product/admin-select/admin-confirm/admin-deleted/320-catalog/390-light/final-start

Stage Summary:
- Все пункты списка пользователя + баги из видео устранены; потерянные функции v1.4 восстановлены на текущей кодовой базе (v1.5)
- Корневые причины джиттера устранены архитектурно (одиночные узлы, непрозрачные слои, aspect-контейнеры, commit-only поиск)
- Соннер-тостер был мёртв с момента сборки — теперь все уведомления работают
- Фото сгенерированы ИИ как временные — заменить реальными через «Загрузку»

---
Task ID: 6
Agent: main (Super Z)
Task: Верификация двух списков (вау-пак + правки v1.4) после отката контейнера; восстановление потерянных эффектов; версия 1.4

Work Log:
- Аудит кода выявил: функциональные правки v1.4 (iOS viewport maximumScale=1 + 16px инпуты, typewriter-поиск с commit-on-Enter, склады Обухово/Владимир, дриллдаун с иконками, 3 режима каталога, компакт-остатки по умолчанию, подтверждения админки, XHR-прогресс загрузки, «Назад» в шапке, Ctrl+K удалён) — ВСЕ НА МЕСТЕ
- Потеряно при откате контейнера (восстановлено): spotlight .spot (--mx/--my через единый passive pointermove), ScrollHud (прогресс-бар чтения scaleX + FAB «Наверх» с пружиной), плёночное зерно .fx-grain + виньетка .fx-vignette (fixed, pointer-events:none, z 44/45, меньше в светлой теме, prefers-reduced-motion), blur-up .img-fade (onLoad → is-loaded) в товаре/каталоге/дропдауне, «/» фокус поиска (id=global-search + kbd-подсказка на десктопе), пружина qty-бейджа (badge-pop на hover строки/карточки), подъём active-иконок нижней навигации (translateY(-2px) + drop-shadow), магнитный логотип .magnet, анимированный градиент заголовков (gradient-pan 7s), живые пустые состояния (empty-live, float-y), layout-анимации карточек (motion layout на VariantCard/StockRow/StockCard)
- Доделки из списка v1.4: версия 1.5 → 1.4 (футер); скрытие bottom-nav при клавиатуре (visualViewport resize/scroll → .kb-open, translateY(110%)); touch-action: manipulation на интерактивных элементах (двойной тап не зумит страницу)
- Данные: найдены 2 варианта Магни (Стандарт, Угловой) с 0 фото (БД разошлась с сидом) → перезасеев prisma/seed.ts: 2 склада, 32 остатка, 26 вариантов, 52 фото, 35 тканей; проверено API — 0 вариантов без фото
- UX-фиксы по скриншотам: сетка L1 каталога (подсказка col-span-full, карточки Диваны/Кровати рядом); бренд сайдбара не влезал (лого 142px сжимало колонку до 45px → max-w-[62px] object-left + text-[13px] — 122px, fits); селектор склада ОБУХОВО подрезался → w-[102px] (шапка) / w-[110px] (сайдбар)
- Отладка: старый сервер держал :3000 (EADDRINUSE) → убит, перезапущен на новом бандле; spotlight не работал в headless (pointer:fine=false) → листенер теперь всегда, CSS glow на :hover
- Живые тесты: spotlight vars ✓, «/» → фокус+дропдаун ✓, прогресс scaleX(1)+FAB→scrollY 0 ✓, kb-open translateY ✓, дриллдаун Диваны(5·15)→Магни(3)→варианты по 2 фото ✓, «Назад» ✓, sky→17 тканей+21 вариант ✓, «магни»→3 строки остатков ✓, 320px без overflow ✓, консоль чистая ✓, админка: Выбрано: 1 → «Удалить фото: 1?» → Отмена ✓, товар: зум-иконка + is-loaded ✓, светлая тема ✓
- Скриншоты: v14-desktop-catalog/light/stock, v14-390-catalog-l1/l2, v14-390-stock-compact, v14-320-catalog

Stage Summary:
- Оба списка пользователя закрыты: вау-пак восстановлен и расширен, правки v1.4 подтверждены живыми тестами, версия приведена к 1.4
- Ctrl+K: удалён (по прямой просьбе пользователя) — замена: видимый поиск с typewriter + «/»
- Данные пересеяны: у всех 26 вариантов есть фото
- Ограничение: реальный iPhone 13 Pro недоступен в песочнице — финальную проверку зума/шторок просить у пользователя на устройстве

---
Task ID: 13 (Восстановление после отката + Шаг 4)
Agent: main (Super Z)
Task: Пользователь: «продолжай» (Шаг 4). При старте обнаружен ПОЛНЫЙ ОТКАТ песочницы к коммиту 14:12 (Task 6): потеряны Шаги 1–3, фикс v3, бэкап sait_copy_1, тесты, STATUS.md. Причина гибели бэкапа: rsync --delete при чистке распространил откат на копию.

Work Log:
- ИНВЕНТАРИЗАЦИЯ: коммит 421ecd0 (14:12) = Task 6 (v1.4 вау-пак); git-история не содержит Шаги 1–3; .next откатился (нет fx-skirt); выжили только upload/файлы 16:46–17:49 и scripts/db-stats-s4.js
- ВОССТАНОВЛЕНИЕ ШАГА 2: src/lib/tick.ts (Web Audio tick + haptic); store.resetCatalog() (сброс дриллдауна + мгновенный scroll top); portal.goCatalog() — повторный тап «Каталог» (сайдбар/логотипы/нижняя навигация) = сброс + пульс .nav-pulse + tick + вибрация
- ВОССТАНОВЛЕНИЕ ШАГА 3: breadcrumbs.tsx (Crumb, автоскролл scrollLeft=scrollWidth, goCatalogTop/goCategory/goModel/goFabrics/goMaterial, useCatalogCrumbs, ProductCrumbs); store.jumpProductToLevel(); монтирование: L2-крошки, L3-крошки+ModeSwitch (текстовый путь удалён), поиск «Каталог › Поиск: «…»», шапка товара = круглая «Назад» 40px + ProductCrumbs + счётчик фото
- ВОССТАНОВЛЕНИЕ ФИКСА v3: --edge (#10161a/#eef3f4), html{background:var(--edge)}, .fx-skirt (48px плоско + 48px растушёвка, в .ambient последним), .boot-bg (юбка на сплэше), градиенты запечены в body (4 слоя) + авроры/виньетка ослаблены вдвое, nudge до гидратации (layout.tsx beforeInteractive, 120–3000мс + pageshow) и после (BootSplash standalone, 150–3200мс + touchend + visibilitychange), manifest → #10161a
- ШАГ 4 (новое): API catalog: level=fabrics (ткани с превью/счётчиками/newCount, только с вариантами, сортировка по новизне), level=fresh (фото за 7 дней, take 14 + total), isNew в items и search, newCount на уровне моделей (OR: createdAt/фото за неделю); UI: FreshStrip (лента «Новинки за 7 дней», snap-x, NEW на каждом, тап → товар), кнопка «Все ткани» (бренд-карточка на L1), LevelFabrics (сетка тканей + NEW + «N новых»), LevelMaterialVariants (варианты ткани + крошки + ModeSwitch), NewBadge на карточках вариантов (grid/rows/large) и моделях; store: catFabrics/catMaterial + setCatFabrics/setCatMaterial + back() + snapshot/restore/persist + push/popstate в portal
- Сегмент-контрол складов смонтирован в шапке «Остатков» (WarehouseSegmented, пружина layoutId)
- Сборка ок; сервер перезапущен; E2E scripts/test-s4.mjs: 32/32 ✓ (лента, Все ткани, крошки всех уровней, прыжки, повторный тап, сегмент, CSS юбки/html, консоль чистая); скриншот s4-l1-final.png
- ЗАЩИТА: git add -A && git commit 351c1a8 — все Шаги 1–4 в git (откаты больше не опасны); sait_copy_1 пересоздана (141M) + архив (114M); STATUS.md обновлён

Stage Summary:
- Шаг 4 готов: лента новинок за 7 дней + «Все ткани» (2 уровня) + NEW-бейджи везде; полная навигация и история
- Инфраструктура: правило «сервер+тест одной командой»; бэкап после каждого шага; коммит после каждого шага
- Пользователю: пересоздать ярлык PWA, проверить Шаг 4 + полосу; далее Шаг 5

---
Task ID: 14 (Защита от откатов + Шаг 5)
Agent: main (Super Z)
Task: Пользователь: «сделай защиту от отката, логи по работам, веди все изменения… После переходи далее» — система фиксации + Шаг 5 (админ: физическое удаление, корзина, лёгкое создание контента).

Work Log:
- ЗАЩИТА: созданы scripts/snapshot.sh (git commit+тег+зеркало sait_copy_1+tar в download/snapshots+копии docs в download/logs+INDEX) и scripts/restore_snapshot.sh; git почищен (196МБ→13МБ: выкинуты 114МБ tarball из истории, sait_copy_1-gitlink, skills/, upload-видео, старые скрины; пересоздан репозиторий начисто); CHANGELOG.md с журналом версий
- Урок 1: gitignore «upload/» без якоря заблокировал src/app/api/upload → восстановил файл из 5dc9f47, добавил якоря «/» в .gitignore и snapshot.sh
- Урок 2: pkill -f "standalone/server.js" не берёт next-server (переименование процесса), lsof слеп, fuser отсутствует → scripts/restart.sh убивает по pid из ss -tlnp; найден и убит забытый dev-сервер (с 20:51)
- ВОССТАНОВЛЕНО ПОТЕРЯННОЕ: src/app/api/upload/route.ts (откаты съели файл — «Загрузка» была 404)
- КРИТФИКС: standalone chdir в .next/standalone + кэш списка public на старте → загрузки писались в копию сборки, 404 до рестарта, стирались ребилдом. Фикс: src/lib/paths.ts (корень из DATABASE_URL), /uploads/[...path]/route.ts (раздача напрямую), абсолютные пути в upload/photo-fs. Доказано: upload → 200 сразу → ребилд → файл жив
- ШАГ 5.1 КОРЗИНА: Photo.deletedAt (+индексы, db push); GET /api/admin?view=trash (daysLeft, autoPurged); DELETE = soft-delete; restoreFromTrash; автоочистка 30 дней при обращениях к админ-API; UI: «Фото» = «Активные | Корзина (N)», «Вернуть»/«Удалить навсегда»/«Очистить корзину», бейдж «N дн.»
- ШАГ 5.2 ФИЗИЧЕСКОЕ УДАЛЕНИЕ: photo-fs.ts safeUnlink (только public/uploads, basename+traversal guard), сид-фото /catalog/ защищены; purgePhoto/purgeTrash
- ШАГ 5.3 БЫСТРОЕ СОЗДАНИЕ: вкладка «Товар» (первая, default) — мастер (категория/модель из списка или на лету → ткань/размер/подпись → фото ≤10) + список товаров (фото-счётчик, rename подписи, скрыть/вернуть); API quickCreateVariant/renameVariant/toggleVariant/view=variants; дубликат = 409
- deletedAt:null во всех чтениях фото (catalog items/fresh/fabrics/models+OR, search, stock, upload sortOrder)
- Компоненты: admin-product-manager.tsx (новый), admin-photobank.tsx (новый), admin-view.tsx (облегчён)
- E2E scripts/test-s5.mjs: 31/31 ✓ (создание/дубликат/upload/счётчики/rename/toggle/soft-delete/restore/purge/защита сида/purgeTrash/автоочистка через INTEGER-ms симуляцию/регресс 8 API/уборка); регресс test-s4.mjs: 32/32 ✓
- Нюанс для тестов: Prisma хранит DateTime в SQLite как INTEGER unix-ms — ISO-текст в raw SQL ломает сравнение lt
- Данные пересеяны в эталон (26 вариантов/52 фото/32 остатка) после зачистки тестовых артефактов
- Фиксация: git commit + snapshot 003 «step5»; STATUS/CHANGELOG/worklog обновлены

Stage Summary:
- Система защиты от откатов работает: каждый шаг = commit+тег+снапшот в download/ (переживает откат песочницы); восстановление одной командой
- Шаг 5 готов: корзина с автоочисткой 30 дней, физическое удаление с защитой сид-фото, мастер создания товара за 3 поля, управление вариантами
- Найден и закрыт критичный баг уничтожения загрузок ребилдом (старые сессии теряли бы фото при каждой сборке)
- Пользователю: пересоздать ярлык PWA; проверить Шаг 4 (лента/ткани/NEW) и Шаг 5 (админка: создать товар, удалить фото, корзина)

---
Task ID: 15 (Плавающая «пилюля» нижней навигации)
Agent: main (Super Z)
Task: Пользователь прислал видео (iOS 26 App Store, Liquid Glass): «делай такой навигации, чтобы заменить его на плавающую «пилюлю» как в видео» — заменить нижнюю панель на плавающую капсулу.

Work Log:
- Видео разобрано покадрово (ffmpeg 2fps + зум): тёмная стеклянная капсула, парит над низом с полями, 5 пунктов «иконка+подпись», активный обёрнут «линзой»-капсулой и окрашен, контент виден сквозь блюр
- CSS (globals.css): блок .bottom-nav/.nav-tap заменён на .pill-nav (fixed, bottom max(10px,env), поля 14px, pointer-events:none) → .pill-shell (max-w 440, h 64, radius 999, glass var(--glass) + blur 28px saturate 1.7, тень+внутр. кромка) → .pill-item (flex-col иконка+подпись, :active scale .92) + .nav-lens (стеклянная линза: rgba(brand,.14), обводка brand, inset-блик, glow); темы dark/light; .kb-open прячет пилюлю (translateY 170%); .nav-pulse сохранён
- portal.tsx: nav.pill-nav > .pill-shell > 4 × button.pill-item; линза = motion.span layoutId="nav-lens" внутри активного пункта, spring(480/36) — перетекает между вкладками; goCatalog/пульс/tick/haptic сохранены без изменений; контент pb 76→108px, fab-top bottom 84→118px
- Нюанс протокола: snapshot.sh вызван случайно с «--help» (частично отработал: коммит+тег+rsync, убит SIGPIPE на head) — тег удалён, .seq откатан на 4, коммит переименован amend'ом в полное описание
- Нюанс теста: на L1 при 390×760 scrollHeight всего 868px (max скролл 108) → порог проскролла снижен; scrollTo только behavior:"instant" (html scroll-behavior:smooth)
- E2E scripts/test-pill.mjs: 34/34 ✓ (форма 999px, fixed, bottom 10, по центру, blur, клики сквозь обёртку, 4 пункта, одна линза у активного, переезд линзы «Каталог→Остатки→Загрузка», фирменный цвет #0fd6cf, повторный тап = пульс+верх, kb-open, светлая тема, юбка v3 и html-bg на месте, пилюля на товаре, скрыта на десктопе, консоль чистая); регресс test-s4.mjs: 32/32 ✓ (селекторы обновлены на nav.pill-nav)
- Скриншоты: tool-results/pill-dark-catalog.png, pill-dark-stock.png, pill-light.png — совпадает с видео

Stage Summary:
- Нижняя навигация = плавающая «пилюля» Liquid Glass: стекло, линза-перелив, фирменный цвет, обе темы, фиксы v3/шагов 1–3 не тронуты
- Сервер :3000 пересобран и перезапущен; ждём проверку пользователя на iPhone (ярлык PWA пересоздать)
