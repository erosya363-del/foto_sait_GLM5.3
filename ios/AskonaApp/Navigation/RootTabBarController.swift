import UIKit
import WebKit

/// Корневой контроллер нативной оболочки.
///
/// Системный UITabBarController (iOS 26 → системный Liquid Glass: материал,
/// рефракция, кромка, selection-линза и её анимация — всё считает iOS;
/// мы НЕ рисуем ни капли, ни стекла, ни фона — п.6/16/30 ТЗ).
///
/// Поверх — один общий WKWebView с существующим сайтом:
///
///     RootTabBarController (UITabBarController, системный Liquid Glass)
///       └─ WKWebView (общий, один на все вкладки, full-bleed под стеклом)
///            └─ сайт (SPA: zustand-разделы catalog/upload/admin/stock)
///
/// Тап по вкладке НЕ перезагружает сайт (п.13 ТЗ): нативная сторона диспатчит
/// DOM-событие "native-tab-change", React переключает zustand-состояние.
final class RootTabBarController: UITabBarController, UITabBarControllerDelegate {

    private let navigationDelegate = WebNavigationDelegate()
    private let bridge = NativeBridge()

    /// Единственный общий WKWebView на все 4 вкладки
    private(set) var webView: WKWebView!

    /// true во время программной смены вкладки ради синхронизации с сайтом —
    /// исключает эхо-петлю «web tabChanged → select → native-tab-change → …»
    private var isApplyingProgrammaticSelection = false

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()

        delegate = self

        // Панель всегда доступна при скролле (п.35 ТЗ): никакого minimize on scroll
        if #available(iOS 26.0, *) {
            tabBarMinimizeBehavior = .off
        }

        // Акцент выбранного пункта = брендовый изумруд сайта (--brand-strong).
        // Материал/фон/прозрачность панели НЕ трогаем — их рисует система (п.6 ТЗ).
        tabBar.tintColor = UIColor(named: "AccentColor")

        buildTabs()
        buildWebView()
        configureKeyboardHandling()

        prepareSelectionHaptics()
    }

    private func buildTabs() {
        let controllers = AppConfiguration.tabs.map { tab in
            WebTabViewController(webTabID: tab.id,
                                 title: tab.title,
                                 symbolName: tab.symbolName)
        }
        viewControllers = controllers
        selectedViewController = controllers.first // «Каталог» — стартовый раздел сайта
    }

    private func buildWebView() {
        let configuration = WebViewFactory.makeConfiguration(bridge: bridge)
        webView = WebViewFactory.makeWebView(configuration: configuration,
                                             navigationDelegate: navigationDelegate)
        bridge.root = self

        // WebView ПОД дочерними контейнерами (они прозрачные) и ПОД tab bar —
        // контент сайта продолжается под системным стеклом (п.19 ТЗ).
        // Никаких белых/чёрных подложек.
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.insertSubview(webView, at: 0)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        // Стартовая загрузка сайта — единственный load() за жизнь приложения.
        // Дальше только SPA-переходы через мост.
        let request = URLRequest(url: AppConfiguration.baseURL)
        webView.load(request)
    }

    // MARK: - Safe Area (п.18 ТЗ)

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()

        // env(safe-area-inset-bottom) внутри сайта должен включать высоту
        // нативной панели, иначе плавающие элементы сайта заедут под стекло.
        // WebView лежит вне иерархии дочерних контроллеров, поэтому safe area
        // панели доводим вручную через additionalSafeAreaInsets — БЕЗ двойного
        // учёта (вычитаем уже пришедший системный инсет home-indicator).
        let barTop = tabBar.frame.minY
        let barVisible = !tabBar.isHidden && barTop < view.bounds.maxY
        let distanceToBar = barVisible ? max(0, view.bounds.height - barTop) : 0
        let bottomInset = max(0, distanceToBar - webView.safeAreaInsets.bottom)

        if webView.additionalSafeAreaInsets.bottom != bottomInset {
            webView.additionalSafeAreaInsets.bottom = bottomInset
        }
    }

    // MARK: - Tab selection (Native → Web, п.9 ТЗ)

    func tabBarController(_ tabBarController: UITabBarController,
                          shouldSelect viewController: UIViewController) -> Bool {
        guard let tabVC = viewController as? WebTabViewController else { return false }

        // Повторный тап УЖЕ активной вкладки: не перезагружаем (п.24 ТЗ),
        // но отдаём сайту событие — «Каталог» использует его как scroll-to-top
        // с сбросом дриллдауна (поведение идентично веб-пилюле)
        if viewController == selectedViewController {
            dispatchTabChange(webTabID: tabVC.webTabID)
            return false
        }
        return true
    }

    func tabBarController(_ tabBarController: UITabBarController,
                          didSelect viewController: UIViewController) {
        // Эхо-фильтр: программные смены (синхронизация с сайтом) событий не шлют
        guard !isApplyingProgrammaticSelection,
              let tabVC = viewController as? WebTabViewController else { return }

        Haptics.selection() // лёгкий системный тик при фактической смене (п.15 ТЗ)
        dispatchTabChange(webTabID: tabVC.webTabID)
    }

    /// Диспатчит DOM-событие в сайт: нативный таб-бар → React (zustand)
    private func dispatchTabChange(webTabID: String) {
        guard let webView else { return }
        let safeID = webTabID.replacingOccurrences(of: "\"", with: "")
        let js = """
        window.dispatchEvent(new CustomEvent("\(AppConfiguration.tabChangeEventName)", { detail: { tab: "\(safeID)" } }));
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    // MARK: - Web → Native синхронизация

    /// Сайт сменил раздел сам (tabChanged) или готов (bridgeReady) —
    /// перемещаем selection-линзу системной анимацией, БЕЗ перезагрузки.
    func selectTab(webTabID: String, animated: Bool) {
        guard let index = AppConfiguration.tabs.firstIndex(where: { $0.id == webTabID }),
              index != selectedIndex else { return }
        isApplyingProgrammaticSelection = true
        selectedViewController = viewControllers?[index]
        isApplyingProgrammaticSelection = false
    }

    /// По запросу сайта (bridgeReady) подтверждаем текущее соответствие
    func syncSelectionToWebTab() {
        let current = AppConfiguration.tabs[min(selectedIndex, AppConfiguration.tabs.count - 1)].id
        // Сайт и так показывает этот раздел; событие безвредно (дедупликация на web-стороне)
        dispatchTabChange(webTabID: current)
    }

    // MARK: - Keyboard (п.17 ТЗ)

    private func configureKeyboardHandling() {
        let center = NotificationCenter.default
        center.addObserver(self,
                           selector: #selector(keyboardWillShow(_:)),
                           name: UIResponder.keyboardWillShowNotification,
                           object: nil)
        center.addObserver(self,
                           selector: #selector(keyboardWillHide(_:)),
                           name: UIResponder.keyboardWillHideNotification,
                           object: nil)
    }

    @objc private func keyboardWillShow(_ note: Notification) {
        // Аппаратная/внешняя клавиатура (или фокус без клавиатуры): рамка за
        // пределами экрана — панель не прячем
        if let end = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
           end.minY >= view.bounds.maxY - 1 {
            return
        }
        // Штатный системный API: панель уходит с экрана анимацией iOS
        setTabBarHidden(true, animated: true)
    }

    @objc private func keyboardWillHide(_ note: Notification) {
        setTabBarHidden(false, animated: true)
    }

    // MARK: - Haptics (п.15 ТЗ)

    private func prepareSelectionHaptics() {
        // Прогрев генератора БЕЗ тика — первый реальный тик без латентности
        Haptics.prepare()
    }

    // MARK: - Cleanup (п.31 ТЗ: без retain cycle)

    deinit {
        NotificationCenter.default.removeObserver(self)
        webView?.configuration.userContentController
            .removeScriptMessageHandler(forName: AppConfiguration.bridgeName)
    }
}
