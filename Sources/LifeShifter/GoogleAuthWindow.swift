import AppKit
import Foundation
import WebKit

struct GoogleTokens: Decodable, Equatable {
    let access: String
    let refresh: String
}

enum GoogleAuthError: LocalizedError {
    case cancelled
    case invalidTokens
    case navigation(String)

    var errorDescription: String? {
        switch self {
        case .cancelled:
            return "Googleログインがキャンセルされました"
        case .invalidTokens:
            return "Timetrackerの認証情報を取得できませんでした"
        case let .navigation(message):
            return "認証画面を開けません: \(message)"
        }
    }
}

@MainActor
final class GoogleAuthWindow: NSObject, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    private static let signInURL = URL(string: "https://timetracker.live/signin")!
    private let completion: (Result<GoogleTokens, Error>) -> Void
    private var window: NSWindow?
    private var popupWindows: [ObjectIdentifier: NSWindow] = [:]
    private var finished = false

    init(completion: @escaping (Result<GoogleTokens, Error>) -> Void) {
        self.completion = completion
    }

    func start() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 700),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Timetracker — Googleログイン"
        window.animationBehavior = .none
        window.contentView = webView
        window.delegate = self
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window

        webView.load(URLRequest(url: Self.signInURL))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let url = webView.url,
              url.scheme == "https",
              url.host == Self.signInURL.host else { return }

        let script = """
        JSON.stringify({
          "access": localStorage.getItem("access_token"),
          "refresh": localStorage.getItem("refresh_token")
        })
        """
        webView.evaluateJavaScript(script) { [weak self] value, _ in
            guard let self, let json = value as? String else { return }
            do {
                let tokens = try Self.decodeTokens(from: json)
                self.finish(.success(tokens))
            } catch {
                // The official sign-in page has not completed authentication yet.
            }
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard navigationAction.targetFrame == nil else { return nil }

        let popup = WKWebView(frame: .zero, configuration: configuration)
        popup.navigationDelegate = self
        popup.uiDelegate = self
        let popupWindow = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 700),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        popupWindow.title = "Googleログイン"
        popupWindow.animationBehavior = .none
        popupWindow.contentView = popup
        popupWindow.center()
        popupWindow.makeKeyAndOrderFront(nil)
        popupWindows[ObjectIdentifier(popup)] = popupWindow
        return popup
    }

    func webViewDidClose(_ webView: WKWebView) {
        let key = ObjectIdentifier(webView)
        DispatchQueue.main.async { [weak self] in
            self?.popupWindows.removeValue(forKey: key)?.orderOut(nil)
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleNavigationError(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleNavigationError(error)
    }

    func windowWillClose(_ notification: Notification) {
        guard !finished else { return }
        finish(.failure(GoogleAuthError.cancelled))
    }

    static func decodeTokens(from json: String) throws -> GoogleTokens {
        let tokens = try JSONDecoder().decode(GoogleTokens.self, from: Data(json.utf8))
        guard !tokens.access.isEmpty, !tokens.refresh.isEmpty else {
            throw GoogleAuthError.invalidTokens
        }
        return tokens
    }

    private func handleNavigationError(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        finish(.failure(GoogleAuthError.navigation(error.localizedDescription)))
    }

    private func finish(_ result: Result<GoogleTokens, Error>) {
        guard !finished else { return }
        finished = true
        DispatchQueue.main.async { [self] in
            for popupWindow in popupWindows.values { popupWindow.orderOut(nil) }
            popupWindows.removeAll()
            window?.orderOut(nil)
            window = nil
            completion(result)
        }
    }
}
