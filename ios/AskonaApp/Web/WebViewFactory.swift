import WebKit

/// Фабрика WKWebView: единая конфигурация для всей оболочки.
///
/// Ключевые решения:
///  - WKWebsiteDataStore.default() — ПЕРСИСТЕНТНОЕ хранилище: cookies,
///    localStorage, sessionStorage, кэш живут между запусками (п.12/32 ТЗ).
///    Никакого ephemeral.
///  - WKUserScript atDocumentStart ставит флаг window.__ASKONA_NATIVE_IOS__
///    и класс html.native-ios-shell — сайт отключает свою HTML-пилюлю
///    (в браузере/PWA класс не появляется, веб-панель остаётся, п.7/8/38 ТЗ).
///  - allowsBackForwardNavigationGestures = false: у сайта собственная
///    back-навигация (History API + слои product/viewer); системный
///    edge-swipe конфликтовал бы с ней двойной обработкой (п.23 ТЗ).
///  - Никакого visual-эффекта/фона поверх панели не создаётся (п.30 ТЗ) —
///    материал tab bar рисует система.
enum WebViewFactory {

    /// Скрипт-маркер нативной оболочки. Выполняется в главном фрейме ДО
    /// любых скриптов страницы — флаг гарантированно виден React-коду
    /// (initNativeIOSBridge в src/lib/native-bridge.ts).
    private static let nativeShellScript: String = """
    (function () {
      window.__ASKONA_NATIVE_IOS__ = true;
      var add = function () {
        var root = document.documentElement;
        if (root && !root.classList.contains('native-ios-shell')) {
          root.classList.add('native-ios-shell');
        }
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', add);
      } else {
        add();
      }
    })();
    """

    static func makeConfiguration(bridge: WKScriptMessageHandler) -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        // Персистентная сессия (общая со всеми WKWebView процесса)
        config.websiteDataStore = WKWebsiteDataStore.default()

        let ucc = WKUserContentController()

        let script = WKUserScript(
            source: nativeShellScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        ucc.addUserScript(script)

        // Регистрация моста через слабую обёртку — без retain cycle
        // (userContentController сильно держит handler, п.31 ТЗ)
        ucc.add(WeakScriptMessageHandler(delegate: bridge), name: AppConfiguration.bridgeName)

        config.userContentController = ucc

        // Медиа сайта (звуки тиков пилюли) играют инлайн без жеста
        config.mediaTypesRequiringUserAction = []
        config.allowsInlineMediaPlayback = true

        // Предпочтения для всплывающих окон сайта: открывать в этом же
        // WebView (target="_blank" не должен уводить контент наружу)
        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        config.defaultWebpagePreferences = prefs

        return config
    }

    static func makeWebView(configuration: WKWebViewConfiguration,
                            navigationDelegate: WKNavigationDelegate?) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = navigationDelegate
        // Сайт сам управляет всеми отступами через env(safe-area-inset-*)
        // и viewport-fit=cover (layout.tsx) — механические UIKit-инсеты не нужны
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .systemBackground
        // Отладка в Safari → Develop → Simulator (не влияет на App Store)
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        return webView
    }
}
