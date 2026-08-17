import AppKit
import Combine
import SwiftUI

@MainActor
final class LifeShifterStore: ObservableObject {
    static let preferredActivityNames = ["研究", "Oedo", "業務", "就活", "TOEIC", "学習", "ジム", "移動", "生活", "休憩", "睡眠"]

    @Published private(set) var activities: [Activity] = []
    @Published private(set) var currentEntry: CurrentEntry?
    @Published private(set) var authenticated = TokenStore.hasAccessToken
    @Published private(set) var isBusy = false
    @Published private(set) var pendingActivityID: Int?
    @Published var errorMessage: String?
    @Published var now = Date()

    private let client = TimetrackerClient()
    private var googleAuthWindow: GoogleAuthWindow?
    private var revision = 0
    private var clockTimer: Timer?
    private var refreshTimer: Timer?
    private var wakeObserver: NSObjectProtocol?

    init() {
        clockTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.now = Date() }
        }
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        if authenticated { refresh() }
    }

    deinit {
        clockTimer?.invalidate()
        refreshTimer?.invalidate()
        if let wakeObserver { NSWorkspace.shared.notificationCenter.removeObserver(wakeObserver) }
    }

    var displayedActivities: [Activity] {
        Array(Self.orderActivities(activities.filter(\.trackable)).prefix(8))
    }

    var elapsedText: String {
        guard let start = currentEntry?.startedAt else { return "--:--" }
        let seconds = max(0, Int(now.timeIntervalSince(start)))
        return String(format: "%d:%02d", seconds / 3600, seconds / 60 % 60)
    }

    var statusText: String {
        guard let currentEntry else { return "LifeShifter" }
        return "\(currentEntry.activityName)  \(elapsedText)"
    }

    func loginWithGoogle() {
        guard googleAuthWindow == nil else { return }
        isBusy = true
        errorMessage = nil

        let authWindow = GoogleAuthWindow { [weak self] result in
            guard let self else { return }
            self.googleAuthWindow = nil
            switch result {
            case let .success(tokens):
                do {
                    try TokenStore.save(access: tokens.access, refresh: tokens.refresh)
                    self.authenticated = true
                    Task {
                        await self.loadFromServer()
                        self.isBusy = false
                    }
                } catch {
                    self.errorMessage = error.localizedDescription
                    self.isBusy = false
                }
            case let .failure(error):
                self.errorMessage = error.localizedDescription
                self.isBusy = false
            }
        }
        googleAuthWindow = authWindow
        authWindow.start()
    }

    func logout() {
        TokenStore.clear()
        authenticated = false
        activities = []
        currentEntry = nil
        pendingActivityID = nil
        errorMessage = nil
    }

    func refresh() {
        guard authenticated, !isBusy else { return }
        isBusy = true
        Task {
            await loadFromServer()
            isBusy = false
        }
    }

    func switchTo(_ activity: Activity) {
        guard authenticated, pendingActivityID == nil, currentEntry?.activityID != activity.id else { return }
        revision += 1
        let requestRevision = revision
        currentEntry = .optimistic(activity: activity, at: now)
        pendingActivityID = activity.id
        errorMessage = nil

        Task {
            do {
                let response = try await client.switchTo(activityID: activity.id)
                guard revision == requestRevision else { return }
                currentEntry = response.newEntry
                pendingActivityID = nil
            } catch {
                guard revision == requestRevision else { return }
                pendingActivityID = nil
                errorMessage = error.localizedDescription
                do { currentEntry = try await client.current() } catch { }
            }
        }
    }

    private func loadFromServer() async {
        do {
            async let loadedActivities = client.listActivities()
            async let loadedCurrent = client.current()
            let (newActivities, newCurrent) = try await (loadedActivities, loadedCurrent)
            activities = newActivities
            if pendingActivityID == nil { currentEntry = newCurrent }
            errorMessage = nil
        } catch {
            if case TimetrackerError.server(401, _) = error {
                authenticated = false
            }
            errorMessage = error.localizedDescription
        }
    }

    static func orderActivities(_ activities: [Activity]) -> [Activity] {
        let preferred = preferredActivityNames.map { $0.lowercased() }
        return activities.enumerated().sorted { left, right in
            let leftRank = preferred.firstIndex(of: left.element.name.lowercased()) ?? Int.max
            let rightRank = preferred.firstIndex(of: right.element.name.lowercased()) ?? Int.max
            return leftRank == rightRank ? left.offset < right.offset : leftRank < rightRank
        }.map(\.element)
    }
}

struct LifeShifterView: View {
    @ObservedObject var store: LifeShifterStore
    var showPanel: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if store.authenticated {
                tracker
            } else {
                LoginView(store: store)
            }
        }
        .padding(16)
        .frame(width: 320)
    }

    private var tracker: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("NOW")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(store.currentEntry?.activityName ?? "未記録")
                        .font(.title2.weight(.bold))
                }
                Spacer()
                Text(store.elapsedText)
                    .font(.system(.title3, design: .monospaced).weight(.semibold))
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(Array(store.displayedActivities.enumerated()), id: \.element.id) { index, activity in
                    modeButton(activity, index: index)
                }
            }

            if store.activities.isEmpty, !store.isBusy {
                Text("切り替え可能なActivityがありません")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 10) {
                if store.isBusy || store.pendingActivityID != nil {
                    ProgressView().controlSize(.small)
                }
                if let error = store.errorMessage {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    Text(error).font(.caption).lineLimit(2)
                } else {
                    Text("Timetrackerと同期済み").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    store.refresh()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .help("今すぐ同期")
            }

            HStack {
                if let showPanel {
                    Button("パネルを表示", action: showPanel).buttonStyle(.link)
                }
                Spacer()
                Button("ログアウト", action: store.logout).buttonStyle(.link)
            }
            .font(.caption)
        }
    }

    private func modeButton(_ activity: Activity, index: Int) -> some View {
        let isActive = store.currentEntry?.activityID == activity.id
        let isPending = store.pendingActivityID == activity.id
        return Button {
            store.switchTo(activity)
        } label: {
            HStack(spacing: 7) {
                Image(systemName: isPending ? "clock" : isActive ? "checkmark.circle.fill" : "circle")
                Text(activity.name).lineLimit(1)
                Spacer(minLength: 0)
            }
            .font(.body.weight(isActive ? .bold : .regular))
            .padding(.horizontal, 11)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(isActive ? Color.accentColor.opacity(0.16) : Color.primary.opacity(0.035))
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .stroke(isActive ? Color.accentColor : Color.secondary.opacity(0.25), lineWidth: isActive ? 2 : 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
        .disabled(store.pendingActivityID != nil || isActive)
        .keyboardShortcut(KeyEquivalent(Character(String(index + 1))), modifiers: [])
        .accessibilityLabel("\(activity.name)へ切り替え")
        .accessibilityValue(isActive ? "現在の活動" : "")
    }
}

private struct LoginView: View {
    @ObservedObject var store: LifeShifterStore

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("LifeShifter").font(.title2.bold())
            Text("TimetrackerへGoogleでログイン")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let error = store.errorMessage {
                Text(error).font(.caption).foregroundStyle(.red)
            }
            Button {
                store.loginWithGoogle()
            } label: {
                if store.isBusy {
                    ProgressView().controlSize(.small).frame(maxWidth: .infinity)
                } else {
                    Label("Googleでログイン", systemImage: "person.crop.circle.badge.checkmark")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(store.isBusy)
            Text("公式Timetrackerの認証画面を開きます。GoogleのパスワードはLifeShifterに保存しません。")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let store = LifeShifterStore()
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let popover = NSPopover()
    private var panel: NSPanel!
    private var cancellable: AnyCancellable?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        configurePanel()
        configureStatusItem()
        store.refresh()
        panel.orderFrontRegardless()
    }

    private func configurePanel() {
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 430),
            styleMask: [.titled, .closable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.title = "LifeShifter"
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.setFrameAutosaveName("LifeShifterPanel")
        panel.contentViewController = NSHostingController(rootView: LifeShifterView(store: store))
        if !panel.setFrameUsingName("LifeShifterPanel"), let screen = NSScreen.main {
            panel.setFrameOrigin(NSPoint(x: screen.visibleFrame.maxX - 340, y: screen.visibleFrame.maxY - 450))
        }
    }

    private func configureStatusItem() {
        guard let button = statusItem.button else { return }
        button.target = self
        button.action = #selector(togglePopover)
        button.toolTip = "LifeShifter"
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(
            rootView: LifeShifterView(store: store, showPanel: { [weak self] in self?.panel.orderFrontRegardless() })
        )
        cancellable = store.$currentEntry.combineLatest(store.$now).sink { [weak self] _, _ in
            self?.statusItem.button?.title = self?.store.statusText ?? "LifeShifter"
        }
    }

    @objc private func togglePopover() {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        }
    }
}

@MainActor
enum SelfCheck {
    static func run() throws {
        let decoder = JSONDecoder()
        let activity = try decoder.decode(Activity.self, from: Data(##"{"id":7,"name":"研究","icon":null,"icon_color":"#123456","parent_id":null,"trackable":true}"##.utf8))
        precondition(activity.id == 7 && activity.name == "研究")

        let current = try decoder.decode(CurrentEntry.self, from: Data(##"{"id":9,"activity_id":7,"activity_name":"研究","activity_icon":null,"activity_icon_color":"#123456","start_time":"2026-08-17T08:00:00Z","end_time":null,"is_active":true}"##.utf8))
        precondition(current.activityID == 7 && current.startedAt != nil)
        let noCurrent = try decoder.decode(CurrentEntry?.self, from: Data("null".utf8))
        precondition(noCurrent == nil)

        let response = try decoder.decode(SwitchResponse.self, from: Data(#"{"new_entry":{"id":10,"activity_id":8,"activity_name":"ジム","activity_icon":null,"activity_icon_color":null,"start_time":"2026-08-17T09:00:00Z","end_time":null,"is_active":true}}"#.utf8))
        precondition(response.newEntry.activityName == "ジム")
        let switchBody = try JSONSerialization.jsonObject(with: JSONEncoder().encode(SwitchRequest(activityID: 8))) as? [String: Int]
        precondition(switchBody == ["activity_id": 8])

        let ordered = LifeShifterStore.orderActivities([
            Activity(id: 1, name: "その他", icon: nil, iconColor: nil, parentID: nil, trackable: true),
            Activity(id: 2, name: "ジム", icon: nil, iconColor: nil, parentID: nil, trackable: true),
            activity
        ])
        precondition(ordered.map { $0.name } == ["研究", "ジム", "その他"])
        let tokens = try GoogleAuthWindow.decodeTokens(from: #"{"access":"test-access","refresh":"test-refresh"}"#)
        precondition(tokens == GoogleTokens(access: "test-access", refresh: "test-refresh"))
        let fieldError = TimetrackerClient.errorMessage(from: Data(#"{"activity_id":["Invalid activity."]}"#.utf8))
        precondition(fieldError == "activity_id: Invalid activity.")
        precondition(TimetrackerClient.baseURL.absoluteString == "https://api.timetracker.live/api/")
        print("LifeShifter self-check passed")
    }
}

try MainActor.assumeIsolated {
    if CommandLine.arguments.contains("--self-check") {
        try SelfCheck.run()
    } else {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        application.run()
    }
}
