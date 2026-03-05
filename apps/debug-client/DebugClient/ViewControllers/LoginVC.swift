import UIKit

@MainActor
protocol LoginVCDelegate: AnyObject {
    func loginVCDidLogin(_ vc: LoginVC)
}

@MainActor
class LoginVC: UIViewController {

    // MARK: - Properties

    weak var delegate: LoginVCDelegate?
    private let authService: AuthService

    private let emailField = UITextField()
    private let passwordField = UITextField()
    private let loginButton = UIButton(type: .system)
    private let errorLabel = UILabel()
    private let activityIndicator = UIActivityIndicatorView(style: .medium)

    // MARK: - Initialization

    init(authService: AuthService) {
        self.authService = authService
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
    }

    // MARK: - UI Setup

    private func setupUI() {
        view.backgroundColor = .systemBackground
        title = "Login"
        isModalInPresentation = true

        let titleLabel = UILabel()
        titleLabel.text = "Meetropolis"
        titleLabel.font = .systemFont(ofSize: 28, weight: .bold)
        titleLabel.textAlignment = .center

        let subtitleLabel = UILabel()
        subtitleLabel.text = "Sign in to your account"
        subtitleLabel.font = .preferredFont(forTextStyle: .subheadline)
        subtitleLabel.textColor = .secondaryLabel
        subtitleLabel.textAlignment = .center

        // Email field
        let emailLabel = UILabel()
        emailLabel.text = "Email"
        emailLabel.font = .preferredFont(forTextStyle: .caption1)
        emailLabel.textColor = .secondaryLabel

        emailField.placeholder = "email@example.com"
        emailField.borderStyle = .roundedRect
        emailField.autocapitalizationType = .none
        emailField.autocorrectionType = .no
        emailField.keyboardType = .emailAddress
        emailField.textContentType = .emailAddress
        emailField.returnKeyType = .next

        // Password field
        let passwordLabel = UILabel()
        passwordLabel.text = "Password"
        passwordLabel.font = .preferredFont(forTextStyle: .caption1)
        passwordLabel.textColor = .secondaryLabel

        passwordField.placeholder = "Password"
        passwordField.borderStyle = .roundedRect
        passwordField.isSecureTextEntry = true
        passwordField.textContentType = .password
        passwordField.returnKeyType = .go

        // Login button
        var buttonConfig = UIButton.Configuration.filled()
        buttonConfig.title = "Login"
        buttonConfig.cornerStyle = .medium
        loginButton.configuration = buttonConfig
        loginButton.addTarget(self, action: #selector(loginTapped), for: .touchUpInside)

        // Error label
        errorLabel.textColor = .systemRed
        errorLabel.font = .preferredFont(forTextStyle: .footnote)
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center
        errorLabel.isHidden = true

        // Activity indicator
        activityIndicator.hidesWhenStopped = true

        // Stack
        let formStack = UIStackView(arrangedSubviews: [
            titleLabel,
            subtitleLabel,
            createSpacer(height: 32),
            emailLabel,
            emailField,
            createSpacer(height: 12),
            passwordLabel,
            passwordField,
            createSpacer(height: 24),
            loginButton,
            createSpacer(height: 12),
            activityIndicator,
            errorLabel,
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

    @objc private func loginTapped() {
        guard let email = emailField.text, !email.isEmpty else {
            showError("Please enter your email address.")
            return
        }

        guard let password = passwordField.text, !password.isEmpty else {
            showError("Please enter your password.")
            return
        }

        setLoading(true)
        errorLabel.isHidden = true

        Task {
            do {
                _ = try await authService.login(email: email, password: password)
                delegate?.loginVCDidLogin(self)
            } catch {
                showError(error.localizedDescription)
            }

            setLoading(false)
        }
    }

    private func showError(_ message: String) {
        errorLabel.text = message
        errorLabel.isHidden = false
    }

    private func setLoading(_ loading: Bool) {
        loginButton.isEnabled = !loading
        emailField.isEnabled = !loading
        passwordField.isEnabled = !loading
        if loading {
            activityIndicator.startAnimating()
        } else {
            activityIndicator.stopAnimating()
        }
    }
}
