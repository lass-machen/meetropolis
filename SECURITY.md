# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security issues seriously. We appreciate your efforts to responsibly
disclose your findings and will make every effort to acknowledge your
contributions.

### How to Report

Please report security vulnerabilities by emailing **security@meetropolis.de**.

**Please do NOT:**
- Open a public GitHub issue for security vulnerabilities
- Disclose the vulnerability publicly before we have addressed it

### What to Include

To help us triage and prioritize, please include:

- Type of issue (e.g., buffer overflow, SQL injection, cross-site scripting)
- Full paths of source file(s) related to the issue
- Location of the affected source code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### Response Timeline

- **Initial Response**: Within 48 hours, we will acknowledge receipt of your report
- **Status Update**: Within 7 days, we will provide an initial assessment
- **Resolution**: We aim to resolve critical issues within 30 days

### Safe Harbor

We consider security research conducted in accordance with this policy to be:

- Authorized concerning any applicable anti-hacking laws
- Authorized concerning any relevant anti-circumvention laws
- Exempt from restrictions in our Terms of Service that would interfere with
  conducting security research

We will not pursue civil action or initiate a complaint to law enforcement for
accidental, good-faith violations of this policy.

### Recognition

We believe in recognizing the work of security researchers who help us keep our
users safe. With your permission, we will publicly acknowledge your contribution
in our release notes.

## Security Best Practices for Contributors

When contributing to this project, please:

1. **Never commit secrets**: Use environment variables for sensitive data
2. **Validate all inputs**: Especially on public-facing endpoints
3. **Use parameterized queries**: Prevent SQL injection via Prisma
4. **Keep dependencies updated**: Run `npm audit` regularly
5. **Follow least privilege**: Request only necessary permissions

## Known Security Considerations

### Authentication
- JWT tokens are used for session management
- Passwords are hashed using bcrypt with appropriate cost factor
- API tokens are hashed before storage

### Data Protection
- Database connections use TLS in production
- CORS is configured to allow only trusted origins
- Sensitive data is not logged

### Infrastructure
- Docker containers run as non-root users where possible
- Traefik handles TLS termination with Let's Encrypt
- Rate limiting should be enabled in production
