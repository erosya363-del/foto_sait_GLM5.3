import Foundation
import WebKit

/// Типизированные сообщения Web → Native (п.10/11 ТЗ).
/// Никакого eval и произвольных команд: только известные типы с валидацией.
enum NativeMessageType: String {
    case tabChanged
    case haptic
    case bridgeReady
}

/// Мост Web → Native.
///
/// Безопасность (п.11 ТЗ):
///  - сообщение принимается только из ГЛАВНОГО фрейма;
///  - securityOrigin / URL должны совпадать с доверенным хостом сайта;
///  - обрабатываются только известные типы сообщений с валидацией полей;
///  - строки из веба НИКОГДА не исполняются как JavaScript.
///
/// Retain cycle (п.31 ТЗ) исключён: userContentController сильно держит
/// обёртку WeakScriptMessageHandler, а NativeBridge в ней — weak.
final class NativeBridge: NSObject, WKScriptMessageHandler {

    weak var root: RootTabBarController?

    // Nonisolated: колбэк WebKit может прийти не из главного потока —
    // вся реальная работа уходит на MainActor явным хопом (строгая
    // изоляция UIKit соблюдается в любом Swift-режиме компиляции).
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        // 1. Только главный фрейм и только доверенный origin
        guard message.frameInfo.isMainFrame else { return }
        let originHost = message.frameInfo.securityOrigin.host
        let urlHost = message.webView?.url?.host
        let trusted = AppConfiguration.allowedHosts.contains(originHost)
            || (urlHost.map(AppConfiguration.allowedHosts.contains) ?? false)
        guard trusted else {
            NSLog("[NativeBridge] отклонено сообщение с недоверенного origin: \(originHost)")
            return
        }

        // 2. Только известные типы; из body достаём СКАЛЯРЫ, не исполняя ничего
        guard let body = message.body as? [String: Any],
              let rawType = body["type"] as? String,
              let type = NativeMessageType(rawValue: rawType) else {
            return
        }

        let tab = body["tab"] as? String
        Task { @MainActor [weak self] in
            self?.handle(type: type, tab: tab)
        }
    }

    @MainActor
    private func handle(type: NativeMessageType, tab: String?) {
        switch type {
        case .bridgeReady:
            // Мост сайта поднялся; нативная сторона подтверждает текущую вкладку,
            // чтобы подсветка всегда соответствовала разделу сайта
            root?.syncSelectionToWebTab()

        case .tabChanged:
            guard let tab else { return }
            root?.selectTab(webTabID: tab, animated: true)

        case .haptic:
            // Лёгкий системный selection-отклик по явной просьбе сайта.
            // Тяжёлых ударов нет (п.15 ТЗ).
            Haptics.selection()
        }
    }
}

/// Слабая обёртка для WKUserContentController.add(_:name:) —
/// стандартный приём против retain cycle handler ↔ contentController.
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {

    private weak var delegate: NativeBridge?

    init(delegate: NativeBridge) {
        self.delegate = delegate
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

/// Централизованный haptic: лёгкий системный selection-тик (п.15 ТЗ).
/// UISelectionFeedbackGenerator — официальный API, никаких vibrate-хаков.
@MainActor
enum Haptics {
    private static let generator = UISelectionFeedbackGenerator()

    /// Прогрев генератора (без тика) — первый реальный тик без латентности.
    static func prepare() {
        generator.prepare()
    }

    /// Лёгкий системный selection-тик. Только при фактической смене выбора.
    static func selection() {
        generator.prepare()
        generator.selectionChanged()
    }
}
