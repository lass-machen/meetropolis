import UIKit

class StatusBannerView: UIView {

    // MARK: - Properties

    var status: ConnectionState = .disconnected {
        didSet {
            updateAppearance()
        }
    }

    // MARK: - UI Elements

    private let dotView = UIView()
    private let statusLabel = UILabel()

    // MARK: - Initialization

    override init(frame: CGRect) {
        super.init(frame: frame)
        setupUI()
        updateAppearance()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    // MARK: - Setup

    private func setupUI() {
        layer.cornerRadius = 6
        clipsToBounds = true

        // Dot
        dotView.translatesAutoresizingMaskIntoConstraints = false
        dotView.layer.cornerRadius = 5
        dotView.clipsToBounds = true

        // Label
        statusLabel.font = .preferredFont(forTextStyle: .footnote)
        statusLabel.translatesAutoresizingMaskIntoConstraints = false

        let stack = UIStackView(arrangedSubviews: [dotView, statusLabel])
        stack.axis = .horizontal
        stack.spacing = 8
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false

        addSubview(stack)

        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 30),

            dotView.widthAnchor.constraint(equalToConstant: 10),
            dotView.heightAnchor.constraint(equalToConstant: 10),

            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    // MARK: - Update

    private func updateAppearance() {
        let color: UIColor
        let text: String

        switch status {
        case .disconnected:
            color = .systemGray
            text = "Disconnected"
        case .connecting:
            color = .systemOrange
            text = "Connecting..."
        case .connected:
            color = .systemGreen
            text = "Connected"
        case .reconnecting:
            color = .systemYellow
            text = "Reconnecting..."
        }

        dotView.backgroundColor = color
        statusLabel.text = text
        statusLabel.textColor = color
        backgroundColor = color.withAlphaComponent(0.1)
    }
}
