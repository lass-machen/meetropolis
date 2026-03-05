import UIKit
import LiveKit

@MainActor
class DashboardVC: UIViewController, LiveKitManagerDelegate {

    // MARK: - Services

    private let apiClient: APIClient
    private let authService: AuthService
    private let livekitManager: LiveKitManager

    // MARK: - UI Elements

    private let scrollView = UIScrollView()
    private let contentStack = UIStackView()

    // Connection section
    private let statusBanner = StatusBannerView()
    private let roomNameLabel = UILabel()
    private let connectButton = UIButton(type: .system)

    // Media section
    private let micSwitch = UISwitch()
    private let micLabel = UILabel()
    private let cameraSwitch = UISwitch()
    private let cameraLabel = UILabel()
    private let screenshareSwitch = UISwitch()
    private let screenshareLabel = UILabel()
    private let videoPreview = VideoPreviewView()

    // Stats section
    private let statsContainer = UIStackView()
    private let rttLabel = UILabel()
    private let jitterLabel = UILabel()
    private let packetLossLabel = UILabel()
    private var statsTimer: Timer?
    private var isStatsExpanded = false

    // State
    private var currentUserInfo: UserInfo?

    // MARK: - Initialization

    init(apiClient: APIClient, authService: AuthService, livekitManager: LiveKitManager) {
        self.apiClient = apiClient
        self.authService = authService
        self.livekitManager = livekitManager
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        livekitManager.delegate = self
        updateConnectionUI()

        Task {
            await loadCurrentUser()
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        statsTimer?.invalidate()
        statsTimer = nil
    }

    // MARK: - UI Setup

    private func setupUI() {
        view.backgroundColor = .systemGroupedBackground
        title = "Dashboard"
        navigationController?.navigationBar.prefersLargeTitles = true

        // Scroll view
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scrollView)

        contentStack.axis = .vertical
        contentStack.spacing = 16
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(contentStack)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            contentStack.topAnchor.constraint(equalTo: scrollView.topAnchor, constant: 16),
            contentStack.leadingAnchor.constraint(equalTo: scrollView.leadingAnchor, constant: 16),
            contentStack.trailingAnchor.constraint(equalTo: scrollView.trailingAnchor, constant: -16),
            contentStack.bottomAnchor.constraint(equalTo: scrollView.bottomAnchor, constant: -16),
            contentStack.widthAnchor.constraint(equalTo: scrollView.widthAnchor, constant: -32),
        ])

        // Build sections
        contentStack.addArrangedSubview(buildConnectionSection())
        contentStack.addArrangedSubview(buildMediaSection())
        contentStack.addArrangedSubview(buildStatsSection())
    }

    // MARK: - Connection Section

    private func buildConnectionSection() -> UIView {
        let card = createCard(title: "Connection")

        statusBanner.translatesAutoresizingMaskIntoConstraints = false

        roomNameLabel.font = .preferredFont(forTextStyle: .subheadline)
        roomNameLabel.textColor = .secondaryLabel
        roomNameLabel.text = "Room: --"

        var connectConfig = UIButton.Configuration.filled()
        connectConfig.title = "Connect"
        connectConfig.cornerStyle = .medium
        connectButton.configuration = connectConfig
        connectButton.addTarget(self, action: #selector(connectTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [
            statusBanner,
            roomNameLabel,
            connectButton,
        ])
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false

        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 40),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
        ])

        return card
    }

    // MARK: - Media Section

    private func buildMediaSection() -> UIView {
        let card = createCard(title: "Media Controls")

        // Mic row
        micSwitch.isOn = false
        micSwitch.isEnabled = false
        micSwitch.addTarget(self, action: #selector(micToggled), for: .valueChanged)
        micLabel.text = "Microphone"
        micLabel.font = .preferredFont(forTextStyle: .body)
        let micRow = createSwitchRow(label: micLabel, control: micSwitch, icon: "mic.fill")

        // Camera row
        cameraSwitch.isOn = false
        cameraSwitch.isEnabled = false
        cameraSwitch.addTarget(self, action: #selector(cameraToggled), for: .valueChanged)
        cameraLabel.text = "Camera"
        cameraLabel.font = .preferredFont(forTextStyle: .body)
        let cameraRow = createSwitchRow(label: cameraLabel, control: cameraSwitch, icon: "video.fill")

        // Screenshare row
        screenshareSwitch.isOn = false
        screenshareSwitch.isEnabled = false
        screenshareSwitch.addTarget(self, action: #selector(screenshareToggled), for: .valueChanged)
        screenshareLabel.text = "Screen Share"
        screenshareLabel.font = .preferredFont(forTextStyle: .body)
        let screenshareRow = createSwitchRow(label: screenshareLabel, control: screenshareSwitch, icon: "rectangle.on.rectangle")

        // Video preview
        videoPreview.translatesAutoresizingMaskIntoConstraints = false
        videoPreview.isHidden = true
        NSLayoutConstraint.activate([
            videoPreview.heightAnchor.constraint(equalToConstant: 120),
        ])

        let stack = UIStackView(arrangedSubviews: [
            micRow,
            cameraRow,
            screenshareRow,
            videoPreview,
        ])
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false

        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 40),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
        ])

        return card
    }

    // MARK: - Stats Section

    private func buildStatsSection() -> UIView {
        let card = createCard(title: "Stats")

        rttLabel.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        rttLabel.text = "RTT: --"
        jitterLabel.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        jitterLabel.text = "Jitter: --"
        packetLossLabel.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        packetLossLabel.text = "Packet Loss: --"

        let toggleButton = UIButton(type: .system)
        toggleButton.setTitle("Show/Hide", for: .normal)
        toggleButton.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
        toggleButton.addTarget(self, action: #selector(toggleStats), for: .touchUpInside)

        statsContainer.axis = .vertical
        statsContainer.spacing = 4
        statsContainer.isHidden = true
        statsContainer.addArrangedSubview(rttLabel)
        statsContainer.addArrangedSubview(jitterLabel)
        statsContainer.addArrangedSubview(packetLossLabel)

        let stack = UIStackView(arrangedSubviews: [
            toggleButton,
            statsContainer,
        ])
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false

        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 40),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
        ])

        return card
    }

    // MARK: - Helpers

    private func createCard(title: String) -> UIView {
        let card = UIView()
        card.backgroundColor = .secondarySystemGroupedBackground
        card.layer.cornerRadius = 12
        card.translatesAutoresizingMaskIntoConstraints = false

        let titleLabel = UILabel()
        titleLabel.text = title
        titleLabel.font = .preferredFont(forTextStyle: .headline)
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(titleLabel)

        NSLayoutConstraint.activate([
            titleLabel.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
            titleLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            titleLabel.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
        ])

        return card
    }

    private func createSwitchRow(label: UILabel, control: UISwitch, icon: String) -> UIView {
        let iconView = UIImageView(image: UIImage(systemName: icon))
        iconView.tintColor = .secondaryLabel
        iconView.contentMode = .scaleAspectFit
        iconView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            iconView.widthAnchor.constraint(equalToConstant: 24),
            iconView.heightAnchor.constraint(equalToConstant: 24),
        ])

        label.setContentHuggingPriority(.defaultLow, for: .horizontal)

        let row = UIStackView(arrangedSubviews: [iconView, label, control])
        row.axis = .horizontal
        row.spacing = 8
        row.alignment = .center
        return row
    }

    // MARK: - Data Loading

    private func loadCurrentUser() async {
        do {
            currentUserInfo = try await authService.fetchCurrentUser()
        } catch {
            // Non-critical, we can continue without user info
        }
    }

    // MARK: - Actions

    @objc private func connectTapped() {
        let isConnected = livekitManager.connectionState == .connected
        if isConnected {
            Task {
                await livekitManager.disconnect()
            }
        } else {
            Task {
                await performConnect()
            }
        }
    }

    private func performConnect() async {
        connectButton.isEnabled = false
        do {
            // 1. Fetch LiveKit URL from API
            struct LiveKitURLResponse: Decodable {
                let url: String
            }
            let urlResponse: LiveKitURLResponse = try await apiClient.request("GET", path: "/livekit/url")
            let livekitURL = urlResponse.url

            // 2. Load user info if needed
            if currentUserInfo == nil {
                currentUserInfo = try await authService.fetchCurrentUser()
            }

            guard let user = currentUserInfo else {
                showAlert(title: "Error", message: "Could not load user info.")
                connectButton.isEnabled = true
                return
            }

            // 3. Get LiveKit token
            struct TokenRequest: Encodable {
                let roomName: String
                let identity: String
                let name: String
            }
            let tokenBody = TokenRequest(
                roomName: "world",
                identity: user.id,
                name: user.name ?? user.email
            )
            let token = try await apiClient.requestText(
                "POST",
                path: "/livekit/token",
                body: tokenBody
            )

            // 4. Connect
            try await livekitManager.connect(url: livekitURL, token: token)
            roomNameLabel.text = "Room: world"

            // Start stats timer
            startStatsTimer()
        } catch {
            showAlert(title: "Connection Error", message: error.localizedDescription)
        }
        connectButton.isEnabled = true
    }

    @objc private func micToggled() {
        Task {
            do {
                try await livekitManager.setMicEnabled(micSwitch.isOn)
            } catch {
                micSwitch.setOn(!micSwitch.isOn, animated: true)
                showAlert(title: "Mic Error", message: error.localizedDescription)
            }
        }
    }

    @objc private func cameraToggled() {
        let enabled = cameraSwitch.isOn
        Task {
            do {
                try await livekitManager.setCameraEnabled(enabled)
                videoPreview.isHidden = !enabled
                // TODO: Attach local video track to preview when camera is enabled
            } catch {
                cameraSwitch.setOn(!enabled, animated: true)
                showAlert(title: "Camera Error", message: error.localizedDescription)
            }
        }
    }

    @objc private func screenshareToggled() {
        Task {
            do {
                try await livekitManager.setScreenshareEnabled(screenshareSwitch.isOn)
            } catch {
                screenshareSwitch.setOn(!screenshareSwitch.isOn, animated: true)
                showAlert(title: "Screenshare Error", message: error.localizedDescription)
            }
        }
    }

    @objc private func toggleStats() {
        isStatsExpanded.toggle()
        UIView.animate(withDuration: 0.25) {
            self.statsContainer.isHidden = !self.isStatsExpanded
        }
    }

    // MARK: - Stats Timer

    private func startStatsTimer() {
        statsTimer?.invalidate()
        statsTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.updateStats()
            }
        }
    }

    private func updateStats() {
        // Stats display is informational; actual values depend on LiveKit SDK stats API
        rttLabel.text = "RTT: --"
        jitterLabel.text = "Jitter: --"
        packetLossLabel.text = "Packet Loss: --"
    }

    // MARK: - Connection UI

    private func updateConnectionUI() {
        let state = livekitManager.connectionState
        statusBanner.status = state

        let isConnected = state == .connected
        let isDisconnected = state == .disconnected

        var config = UIButton.Configuration.filled()
        config.title = isConnected ? "Disconnect" : "Connect"
        config.baseBackgroundColor = isConnected ? .systemRed : .systemBlue
        config.cornerStyle = .medium
        connectButton.configuration = config
        connectButton.isEnabled = isDisconnected || isConnected

        micSwitch.isEnabled = isConnected
        cameraSwitch.isEnabled = isConnected
        screenshareSwitch.isEnabled = isConnected

        if !isConnected {
            micSwitch.isOn = false
            cameraSwitch.isOn = false
            screenshareSwitch.isOn = false
            videoPreview.isHidden = true
            statsTimer?.invalidate()
            statsTimer = nil
        }
    }

    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    // MARK: - LiveKitManagerDelegate

    nonisolated func livekitManager(_ manager: LiveKitManager, didChangeConnectionState state: ConnectionState) {
        Task { @MainActor in
            updateConnectionUI()
        }
    }

    nonisolated func livekitManager(_ manager: LiveKitManager, participantDidJoin participant: RemoteParticipant) {
        // Handled by ParticipantsVC
    }

    nonisolated func livekitManager(_ manager: LiveKitManager, participantDidLeave participant: RemoteParticipant) {
        // Handled by ParticipantsVC
    }

    nonisolated func livekitManager(_ manager: LiveKitManager, participant: RemoteParticipant, didPublishTrack publication: RemoteTrackPublication) {
        // Handled by ParticipantsVC
    }

    nonisolated func livekitManager(_ manager: LiveKitManager, participant: RemoteParticipant, didUnpublishTrack publication: RemoteTrackPublication) {
        // Handled by ParticipantsVC
    }
}
