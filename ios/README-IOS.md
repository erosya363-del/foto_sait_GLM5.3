# AskonaApp — нативная iOS-оболочка (UIKit + WKWebView)

Нативная оболочка для сайта «Склад мебели · Askona»: сайт продолжают
отрисовывать WebKit и React, а **нижняя навигация становится настоящим
системным `UITabBar`** — Liquid Glass, рефракцию, кромку, selection-линзу и её
анимацию считает и рисует сама iOS 26. Никаких CSS/backdrop-filter имитаций.

```
iPhone
   ↓
Native iOS shell (UIKit, @main AppDelegate → SceneDelegate)
   ↓
RootTabBarController (UITabBarController, системный Liquid Glass)
   ↓  selection-линза, хаптики, скрытие при клавиатуре — нативно
WKWebView (один общий, персистентная сессия, никогда не перезагружается)
   ↓
Существующий сайт (Next.js SPA: zustand-разделы catalog/upload/admin/stock)
```

## Состав

| Файл | Ответственность |
|---|---|
| `AskonaApp/AppDelegate.swift` | точка входа (`@main`), конфигурация сцены |
| `AskonaApp/SceneDelegate.swift` | окно → `RootTabBarController` |
| `AskonaApp/Navigation/RootTabBarController.swift` | системный tab bar, линза, хаптики, клавиатура, safe area, мост |
| `AskonaApp/Web/WebViewFactory.swift` | WKWebView: персистентный data store, скрипт-маркер, мост |
| `AskonaApp/Web/WebTabViewController.swift` | прозрачные носители пунктов таб-бара |
| `AskonaApp/Web/NativeBridge.swift` | WKScriptMessageHandler (`nativeApp`), валидация сообщений, haptics |
| `AskonaApp/Web/WebNavigationDelegate.swift` | внешние ссылки → Safari, восстановление после смерти процесса |
| `AskonaApp/Configuration/AppConfiguration.swift` | URL сайта, доверенные хосты, вкладки, SF Symbols |
| `AskonaApp/Resources/Info.plist` | launch screen, сценовое приложение, минимальные разрешения |
| `AskonaApp/Resources/Assets.xcassets` | AppIcon (1024), AccentColor (светлый/тёмный изумруд) |

## Вкладки таб-бара

| Пункт | SF Symbol | Раздел сайта (zustand `View`) |
|---|---|---|
| Каталог | `square.grid.2x2` | `catalog` |
| Загрузка | `square.and.arrow.up` | `upload` |
| Админ | `gearshape` | `admin` |
| Остатки | `shippingbox` | `stock` |

Порядок и иконки задаются в `AppConfiguration.tabs`. Все символы существуют
в iOS 26 SDK (проверено: iOS 14+ каждый).

## Как работает мост (без перезагрузок)

* **Native → Web:** тап по вкладке → `didSelect` → системная линза переехала →
  `evaluateJavaScript` диспатчит `CustomEvent("native-tab-change", {detail:{tab}})` →
  React (`src/lib/native-bridge.ts`) переключает zustand-раздел. Повторный тап
  «Каталог» = scroll-to-top + сброс дриллдауна (как у веб-пилюли).
* **Web → Native:** сайт при смене раздела шлёт `window.webkit.messageHandlers.nativeApp.postMessage({type:"tabChanged", tab})` —
  линза перезжает системной анимацией. Эхо-петли исключены двусторонне
  (`isApplyingProgrammaticSelection` + дедупликация на web-стороне).
* **Один WebView на все вкладки:** сайт — SPA без URL-роутов, поэтому
  `reload()`/`load()` после стартового не существует. Состояние разделов,
  localStorage, cookies живут между вкладками и перезапусками
  (`WKWebsiteDataStore.default()`).
* **Клавиатура:** `UIKeyboardWillShow/WillHide` → штатный
  `setTabBarHidden(_:animated:)` (iOS 18+ API). Никаких ручных трансформаций.
* **Safe area:** WebView full-bleed под стеклом (контент виден под панелью —
  рефракция работает), нижний инсет панели доводится до сайта через
  `additionalSafeAreaInsets` → внутри CSS `env(safe-area-inset-bottom)`
  уже включает высоту нативного таб-бара. Двойного inset нет: веб-пилюля в
  native-режиме скрыта (`html.native-ios-shell .pill-nav { display:none }`).
* **Внешние ссылки:** чужие домены открываются в Safari и никогда не получают
  мост; мост принимает только main-frame сообщения с доверенного origin.
* **Reduce Motion / Reduce Transparency / Light–Dark:** полностью системные —
  материал и анимации таб-бара адаптирует сама iOS, вмешательства нет.

## Сборка (требуется macOS + Xcode 26)

```bash
cd ios
xcodebuild -project AskonaApp.xcodeproj -scheme AskonaApp \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

Запуск в симуляторе:

```bash
xcrun simctl boot "iPhone 17 Pro"
xcodebuild -project AskonaApp.xcodeproj -scheme AskonaApp \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
open -a Simulator
# Cmd+R в Xcode или:
xcrun simctl install booted <путь до AskonaApp.app>
xcrun simctl launch booted ru.askona.skovo
```

Единственный ручной шаг: открыть `ios/AskonaApp.xcodeproj` в Xcode и выбрать
ваш **Team** (Signing & Capabilities) для сборки на физический iPhone.
Для симулятора подпись не нужна.

### Конфигурация

* URL сайта — `AppConfiguration.baseURL` (сейчас публичный деплой;
  для отладки против локального `next dev` замените на
  `http://localhost:3000` — ATS-исключение `NSAllowsLocalNetworking` уже есть).
* Доверенные хосты — `AppConfiguration.allowedHosts` (мост + навигация внутри WebView).

## Что нужно проверить на реальном iPhone (симулятор не достаточен)

1. Haptic: лёгкий selection-тик на каждом фактическом переключении вкладки.
2. Liquid Glass: рефракция контента под панелью на фото/тексте/градиентах,
   светлая и тёмная темы.
3. Клавиатура: панель уходит/возвращается штатной анимацией, без прыжков.
4. Настройки → Accessibility: Reduce Transparency (панель непрозрачнее) и
   Reduce Motion (линза без анимаций) — системное поведение.
