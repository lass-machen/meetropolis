import UIKit

@MainActor
protocol ParticipantCellDelegate: AnyObject {
    func participantCell(_ cell: ParticipantCell, didToggleAudio subscribed: Bool, for participantId: String)
    func participantCell(_ cell: ParticipantCell, didToggleVideo subscribed: Bool, for participantId: String)
}

class ParticipantCell: UITableViewCell {

    // MARK: - Constants

    static let reuseIdentifier = "ParticipantCell"

    // MARK: - Properties

    weak var delegate: ParticipantCellDelegate?
    private var participantIdentity: String = ""

    // MARK: - UI Elements

    private let nameLabel = UILabel()
    private let subtitleLabel = UILabel()

    private let micIcon = UIImageView()
    private let cameraIcon = UIImageView()
    private let screenIcon = UIImageView()

    private let audioSwitch = UISwitch()
    private let videoSwitch = UISwitch()
    private let audioLabel = UILabel()
    private let videoLabel = UILabel()

    // MARK: - Initialization

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        setupUI()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    // MARK: - UI Setup

    private func setupUI() {
        // Name column
        nameLabel.font = .preferredFont(forTextStyle: .headline)
        nameLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)
        nameLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        subtitleLabel.font = .preferredFont(forTextStyle: .caption1)
        subtitleLabel.textColor = .secondaryLabel
        subtitleLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)
        subtitleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let nameStack = UIStackView(arrangedSubviews: [nameLabel, subtitleLabel])
        nameStack.axis = .vertical
        nameStack.spacing = 2

        // Status icons
        configureIcon(micIcon, systemName: "mic.fill")
        configureIcon(cameraIcon, systemName: "video.fill")
        configureIcon(screenIcon, systemName: "rectangle.on.rectangle")
        screenIcon.isHidden = true

        let iconStack = UIStackView(arrangedSubviews: [micIcon, cameraIcon, screenIcon])
        iconStack.axis = .horizontal
        iconStack.spacing = 6
        iconStack.alignment = .center

        // Switch controls
        audioSwitch.transform = CGAffineTransform(scaleX: 0.7, y: 0.7)
        audioSwitch.addTarget(self, action: #selector(audioSwitchToggled), for: .valueChanged)

        audioLabel.text = "Audio"
        audioLabel.font = .preferredFont(forTextStyle: .caption2)
        audioLabel.textColor = .secondaryLabel

        let audioRow = UIStackView(arrangedSubviews: [audioLabel, audioSwitch])
        audioRow.axis = .horizontal
        audioRow.spacing = 4
        audioRow.alignment = .center

        videoSwitch.transform = CGAffineTransform(scaleX: 0.7, y: 0.7)
        videoSwitch.addTarget(self, action: #selector(videoSwitchToggled), for: .valueChanged)

        videoLabel.text = "Video"
        videoLabel.font = .preferredFont(forTextStyle: .caption2)
        videoLabel.textColor = .secondaryLabel

        let videoRow = UIStackView(arrangedSubviews: [videoLabel, videoSwitch])
        videoRow.axis = .horizontal
        videoRow.spacing = 4
        videoRow.alignment = .center

        let switchStack = UIStackView(arrangedSubviews: [audioRow, videoRow])
        switchStack.axis = .vertical
        switchStack.spacing = 4
        switchStack.alignment = .trailing

        // Main layout
        let mainStack = UIStackView(arrangedSubviews: [nameStack, iconStack, switchStack])
        mainStack.axis = .horizontal
        mainStack.spacing = 12
        mainStack.alignment = .center
        mainStack.translatesAutoresizingMaskIntoConstraints = false

        contentView.addSubview(mainStack)

        NSLayoutConstraint.activate([
            mainStack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12),
            mainStack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            mainStack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            mainStack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -12),
        ])
    }

    private func configureIcon(_ imageView: UIImageView, systemName: String) {
        imageView.image = UIImage(systemName: systemName)
        imageView.contentMode = .scaleAspectFit
        imageView.tintColor = .secondaryLabel
        imageView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            imageView.widthAnchor.constraint(equalToConstant: 20),
            imageView.heightAnchor.constraint(equalToConstant: 20),
        ])
    }

    // MARK: - Configuration

    func configure(with info: ParticipantInfo) {
        participantIdentity = info.identity
        nameLabel.text = info.name ?? info.identity
        subtitleLabel.text = info.name != nil && info.name != info.identity ? info.identity : nil
        subtitleLabel.isHidden = subtitleLabel.text == nil

        // Mic icon
        micIcon.image = UIImage(systemName: info.isAudioPublishing ? "mic.fill" : "mic.slash.fill")
        micIcon.tintColor = info.isAudioPublishing ? .systemGreen : .tertiaryLabel

        // Camera icon
        cameraIcon.image = UIImage(systemName: info.isVideoPublishing ? "video.fill" : "video.slash.fill")
        cameraIcon.tintColor = info.isVideoPublishing ? .systemGreen : .tertiaryLabel

        // Screen icon
        screenIcon.isHidden = !info.isScreensharePublishing
        screenIcon.tintColor = .systemBlue

        // Switches
        audioSwitch.isOn = info.isAudioSubscribed
        audioSwitch.isEnabled = info.isAudioPublishing
        videoSwitch.isOn = info.isVideoSubscribed
        videoSwitch.isEnabled = info.isVideoPublishing
    }

    // MARK: - Actions

    @objc private func audioSwitchToggled() {
        delegate?.participantCell(self, didToggleAudio: audioSwitch.isOn, for: participantIdentity)
    }

    @objc private func videoSwitchToggled() {
        delegate?.participantCell(self, didToggleVideo: videoSwitch.isOn, for: participantIdentity)
    }

    // MARK: - Reuse

    override func prepareForReuse() {
        super.prepareForReuse()
        nameLabel.text = nil
        subtitleLabel.text = nil
        subtitleLabel.isHidden = true
        screenIcon.isHidden = true
        audioSwitch.isOn = false
        videoSwitch.isOn = false
        participantIdentity = ""
    }
}
