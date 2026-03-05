import UIKit
import LiveKit

@MainActor
class ParticipantsVC: UIViewController, LiveKitManagerDelegate, ParticipantCellDelegate {

    // MARK: - Services

    private let livekitManager: LiveKitManager

    // MARK: - UI Elements

    private let tableView = UITableView(frame: .zero, style: .insetGrouped)
    private let headerLabel = UILabel()
    private var dataSource: UITableViewDiffableDataSource<Section, ParticipantInfo>!

    // MARK: - Types

    private enum Section: Hashable {
        case participants
    }

    // MARK: - Initialization

    init(livekitManager: LiveKitManager) {
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
        setupDataSource()
        livekitManager.delegate = self
        updateParticipants()
    }

    // MARK: - UI Setup

    private func setupUI() {
        view.backgroundColor = .systemGroupedBackground
        title = "Participants"
        navigationController?.navigationBar.prefersLargeTitles = true

        // Header
        headerLabel.font = .preferredFont(forTextStyle: .subheadline)
        headerLabel.textColor = .secondaryLabel
        headerLabel.text = "0 participants in room"

        let headerContainer = UIView()
        headerContainer.frame = CGRect(x: 0, y: 0, width: 0, height: 44)
        headerLabel.translatesAutoresizingMaskIntoConstraints = false
        headerContainer.addSubview(headerLabel)
        NSLayoutConstraint.activate([
            headerLabel.leadingAnchor.constraint(equalTo: headerContainer.leadingAnchor, constant: 20),
            headerLabel.centerYAnchor.constraint(equalTo: headerContainer.centerYAnchor),
        ])

        // Table view
        tableView.translatesAutoresizingMaskIntoConstraints = false
        tableView.register(ParticipantCell.self, forCellReuseIdentifier: ParticipantCell.reuseIdentifier)
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 80
        tableView.tableHeaderView = headerContainer
        tableView.delegate = self
        view.addSubview(tableView)

        // Pull to refresh
        let refreshControl = UIRefreshControl()
        refreshControl.addTarget(self, action: #selector(refreshPulled), for: .valueChanged)
        tableView.refreshControl = refreshControl

        NSLayoutConstraint.activate([
            tableView.topAnchor.constraint(equalTo: view.topAnchor),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    private func setupDataSource() {
        dataSource = UITableViewDiffableDataSource<Section, ParticipantInfo>(
            tableView: tableView
        ) { [weak self] tableView, indexPath, participantInfo in
            guard let cell = tableView.dequeueReusableCell(
                withIdentifier: ParticipantCell.reuseIdentifier,
                for: indexPath
            ) as? ParticipantCell else {
                return UITableViewCell()
            }
            cell.configure(with: participantInfo)
            cell.delegate = self
            return cell
        }
    }

    // MARK: - Data

    private func updateParticipants() {
        let participants = livekitManager.remoteParticipants
        let infos = participants.map { participant -> ParticipantInfo in
            buildParticipantInfo(from: participant)
        }

        headerLabel.text = "\(infos.count) participant\(infos.count == 1 ? "" : "s") in room"

        var snapshot = NSDiffableDataSourceSnapshot<Section, ParticipantInfo>()
        snapshot.appendSections([.participants])
        snapshot.appendItems(infos, toSection: .participants)
        dataSource.apply(snapshot, animatingDifferences: true)
    }

    private func buildParticipantInfo(from participant: RemoteParticipant) -> ParticipantInfo {
        let identity = participant.identity?.stringValue ?? "unknown"
        let name = participant.name

        var isAudioPublishing = false
        var isVideoPublishing = false
        var isScreensharePublishing = false
        var isAudioSubscribed = false
        var isVideoSubscribed = false

        for pub in participant.trackPublications.values {
            guard let remotePub = pub as? RemoteTrackPublication else { continue }
            switch remotePub.source {
            case .microphone:
                isAudioPublishing = true
                isAudioSubscribed = remotePub.isSubscribed
            case .camera:
                isVideoPublishing = true
                isVideoSubscribed = remotePub.isSubscribed
            case .screenShareVideo:
                isScreensharePublishing = true
            default:
                break
            }
        }

        return ParticipantInfo(
            identity: identity,
            name: name,
            isAudioPublishing: isAudioPublishing,
            isVideoPublishing: isVideoPublishing,
            isScreensharePublishing: isScreensharePublishing,
            isAudioSubscribed: isAudioSubscribed,
            isVideoSubscribed: isVideoSubscribed,
            audioLevel: 0
        )
    }

    // MARK: - Actions

    @objc private func refreshPulled() {
        updateParticipants()
        tableView.refreshControl?.endRefreshing()
    }

    // MARK: - ParticipantCellDelegate

    func participantCell(_ cell: ParticipantCell, didToggleAudio subscribed: Bool, for participantId: String) {
        Task {
            guard let participant = livekitManager.remoteParticipants.first(where: {
                $0.identity?.stringValue == participantId
            }) else { return }

            for pub in participant.trackPublications.values {
                guard let remotePub = pub as? RemoteTrackPublication,
                      remotePub.source == .microphone else { continue }
                do {
                    if subscribed {
                        try await livekitManager.subscribe(to: remotePub)
                    } else {
                        try await livekitManager.unsubscribe(from: remotePub)
                    }
                } catch {
                    showAlert(title: "Error", message: "Failed to toggle audio: \(error.localizedDescription)")
                }
            }
        }
    }

    func participantCell(_ cell: ParticipantCell, didToggleVideo subscribed: Bool, for participantId: String) {
        Task {
            guard let participant = livekitManager.remoteParticipants.first(where: {
                $0.identity?.stringValue == participantId
            }) else { return }

            for pub in participant.trackPublications.values {
                guard let remotePub = pub as? RemoteTrackPublication,
                      remotePub.source == .camera else { continue }
                do {
                    if subscribed {
                        try await livekitManager.subscribe(to: remotePub)
                    } else {
                        try await livekitManager.unsubscribe(from: remotePub)
                    }
                } catch {
                    showAlert(title: "Error", message: "Failed to toggle video: \(error.localizedDescription)")
                }
            }
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
            updateParticipants()
        }
    }

    nonisolated func livekitManager(_ manager: LiveKitManager, participantDidJoin participant: RemoteParticipant) {
        Task { @MainActor in
            updateParticipants()
        }
    }

    nonisolated func livekitManager(_ manager: LiveKitManager, participantDidLeave participant: RemoteParticipant) {
        Task { @MainActor in
            updateParticipants()
        }
    }

    nonisolated func livekitManager(_ manager: LiveKitManager, participant: RemoteParticipant, didPublishTrack publication: RemoteTrackPublication) {
        Task { @MainActor in
            updateParticipants()
        }
    }

    nonisolated func livekitManager(_ manager: LiveKitManager, participant: RemoteParticipant, didUnpublishTrack publication: RemoteTrackPublication) {
        Task { @MainActor in
            updateParticipants()
        }
    }
}

// MARK: - UITableViewDelegate

extension ParticipantsVC: UITableViewDelegate {

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)

        guard let info = dataSource.itemIdentifier(for: indexPath) else { return }

        // Show detail alert with participant info
        let message = """
        Identity: \(info.identity)
        Name: \(info.name ?? "--")
        Audio: \(info.isAudioPublishing ? "Publishing" : "Not publishing")
        Video: \(info.isVideoPublishing ? "Publishing" : "Not publishing")
        Screen: \(info.isScreensharePublishing ? "Publishing" : "Not publishing")
        """
        let alert = UIAlertController(title: info.name ?? info.identity, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
