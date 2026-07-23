import UIKit

@MainActor
protocol ServerConfigVCDelegate: AnyObject {
    func serverConfigVCDidSave(_ vc: ServerConfigVC, config: ServerConfig)
}

@MainActor
class ServerConfigVC: UIViewController {

    // MARK: - Properties

    weak var delegate: ServerConfigVCDelegate?

    private let apiURLField = UITextField()
    private let tenantField = UITextField()
    private let validateButton = UIButton(type: .system)
    private let statusLabel = UILabel()
    private let activityIndicator = UIActivityIndicatorView(style: .medium)

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
    }

    // MARK: - UI Setup

    private func setupUI() {
        view.backgroundColor = .systemBackground
        title = "Server Configuration"
        navigationItem.largeTitleDisplayMode = .always

        isModalInPresentation = true

        let titleLabel = UILabel()
        titleLabel.text = "Meetropolis Debug Client"
        titleLabel.font = .systemFont(ofSize: 28, weight: .bold)
        titleLabel.textAlignment = .center
        titleLabel.translatesAutoresizingMaskIntoConstraints = false

        let subtitleLabel = UILabel()
        subtitleLabel.text = "Enter your server details to get started."
        subtitleLabel.font = .preferredFont(forTextStyle: .subheadline)
        subtitleLabel.textColor = .secondaryLabel
        subtitleLabel.textAlignment = .center
        subtitleLabel.translatesAutoresizingMaskIntoConstraints = false

        // API URL field
        let apiURLLabel = UILabel()
        apiURLLabel.text = "API URL"
        apiURLLabel.font = .preferredFont(forTextStyle: .caption1)
        apiURLLabel.textColor = .secondaryLabel

        apiURLField.placeholder = "https://api.meetropolis.live"
        apiURLField.borderStyle = .roundedRect
        apiURLField.autocapitalizationType = .none
        apiURLField.autocorrectionType = .no
        apiURLField.keyboardType = .URL
        apiURLField.returnKeyType = .next
        apiURLField.clearButtonMode = .whileEditing

        // Load existing config if available
        if let existing = ServerConfig.load() {
            apiURLField.text = existing.apiBaseURL
        }

        // Tenant field
        let tenantLabel = UILabel()
        tenantLabel.text = "Tenant Slug"
        tenantLabel.font = .preferredFont(forTextStyle: .caption1)
        tenantLabel.textColor = .secondaryLabel

        tenantField.placeholder = "default"
        tenantField.text = "default"
        tenantField.borderStyle = .roundedRect
        tenantField.autocapitalizationType = .none
        tenantField.autocorrectionType = .no
        tenantField.returnKeyType = .done

        // Validate button
        var buttonConfig = UIButton.Configuration.filled()
        buttonConfig.title = "Validate & Save"
        buttonConfig.cornerStyle = .medium
        validateButton.configuration = buttonConfig
        validateButton.addTarget(self, action: #selector(validateTapped), for: .touchUpInside)

        // Status label
        statusLabel.textAlignment = .center
        statusLabel.font = .preferredFont(forTextStyle: .body)
        statusLabel.numberOfLines = 0
        statusLabel.isHidden = true

        // Activity indicator
        activityIndicator.hidesWhenStopped = true

        // Stack view
        let formStack = UIStackView(arrangedSubviews: [
            titleLabel,
            subtitleLabel,
            createSpacer(height: 24),
            apiURLLabel,
            apiURLField,
            createSpacer(height: 12),
            tenantLabel,
            tenantField,
            createSpacer(height: 24),
            validateButton,
            createSpacer(height: 12),
            activityIndicator,
            statusLabel,
        ])
        formStack.axis = .vertical
        formStack.spacing = 4
        formStack.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(formStack)

        NSLayoutConstraint.activate([
            formStack.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -40),
            formStack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor, constant: 16),
            formStack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor, constant: -16),
        ])
    }

    private func createSpacer(height: CGFloat) -> UIView {
        let spacer = UIView()
        spacer.translatesAutoresizingMaskIntoConstraints = false
        spacer.heightAnchor.constraint(equalToConstant: height).isActive = true
        return spacer
    }

    // MARK: - Actions

    @objc private func validateTapped() {
        guard let urlString = apiURLField.text, !urlString.isEmpty else {
            showStatus(text: "Please enter an API URL.", success: false)
            return
        }

        guard let baseURL = URL(string: urlString) else {
            showStatus(text: "Invalid URL format.", success: false)
            return
        }

        let tenant = tenantField.text?.isEmpty == false ? tenantField.text! : "default"

        validateButton.isEnabled = false
        activityIndicator.startAnimating()
        statusLabel.isHidden = true

        Task {
            do {
                let client = APIClient(baseURL: baseURL, tenant: tenant)
                let isValid = try await client.validateServer()

                if isValid {
                    var config = ServerConfig(apiBaseURL: urlString)
                    config.save()
                    ServerConfig.shared = config

                    showStatus(text: "Server validated successfully.", success: true)

                    try? await Task.sleep(for: .milliseconds(500))
                    delegate?.serverConfigVCDidSave(self, config: config)
                } else {
                    showStatus(text: "Server validation failed.", success: false)
                }
            } catch {
                showStatus(text: "Error: \(error.localizedDescription)", success: false)
            }

            validateButton.isEnabled = true
            activityIndicator.stopAnimating()
        }
    }

    private func showStatus(text: String, success: Bool) {
        statusLabel.isHidden = false
        let icon = success ? "\u{2705}" : "\u{274C}"
        statusLabel.text = "\(icon) \(text)"
        statusLabel.textColor = success ? .systemGreen : .systemRed
    }
}
