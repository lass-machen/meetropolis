import React from 'react';

export function TermsOfService({ onBack }: { onBack?: () => void }) {
  return (
    <div style={styles.container}>
      <div style={styles.content}>
        {onBack && (
          <button onClick={onBack} style={styles.backBtn}>
            &larr; Back
          </button>
        )}

        <h1 style={styles.title}>Terms of Service / Nutzungsbedingungen</h1>
        <p style={styles.lastUpdated}>Last updated: December 2024</p>

        <section style={styles.section}>
          <h2 style={styles.heading}>1. Agreement to Terms / Zustimmung</h2>
          <p style={styles.text}>
            By accessing or using Meetropolis ("Service"), you agree to be bound by these Terms of Service ("Terms").
            If you disagree with any part of these terms, you may not access the Service.
          </p>
          <p style={styles.text}>
            Mit dem Zugriff auf oder der Nutzung von Meetropolis ("Dienst") erklaren Sie sich mit diesen
            Nutzungsbedingungen ("Bedingungen") einverstanden. Wenn Sie mit einem Teil dieser Bedingungen
            nicht einverstanden sind, durfen Sie den Dienst nicht nutzen.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>2. Description of Service / Beschreibung des Dienstes</h2>
          <p style={styles.text}>
            Meetropolis is a virtual office platform that enables teams to collaborate through
            avatar-based presence, audio/video communication, and real-time interactions.
          </p>
          <p style={styles.text}>We offer:</p>
          <ul style={styles.list}>
            <li><strong>Free Tier:</strong> Self-hosted version with 25 concurrent user limit</li>
            <li><strong>Paid Plans:</strong> Hosted service with various user limits and features</li>
            <li><strong>Enterprise:</strong> Custom solutions with unlimited users</li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>3. User Accounts / Benutzerkonten</h2>
          <p style={styles.text}>
            To use certain features of the Service, you must register for an account. You agree to:
          </p>
          <ul style={styles.list}>
            <li>Provide accurate and complete registration information</li>
            <li>Maintain the security of your password and account</li>
            <li>Promptly notify us of any unauthorized access</li>
            <li>Accept responsibility for all activities under your account</li>
          </ul>
          <p style={styles.text}>
            You must be at least 16 years old to create an account.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>4. Acceptable Use / Zulassige Nutzung</h2>
          <p style={styles.text}>You agree NOT to use the Service to:</p>
          <ul style={styles.list}>
            <li>Violate any applicable laws or regulations</li>
            <li>Infringe intellectual property rights of others</li>
            <li>Harass, abuse, or harm other users</li>
            <li>Transmit malware, spam, or malicious content</li>
            <li>Attempt to gain unauthorized access to systems</li>
            <li>Interfere with or disrupt the Service</li>
            <li>Resell or redistribute the Service without authorization</li>
            <li>Use the Service for illegal activities</li>
          </ul>
          <p style={styles.text}>
            Violation of these terms may result in immediate account termination.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>5. Subscriptions and Payment / Abonnements und Zahlung</h2>
          <h3 style={styles.subheading}>Billing</h3>
          <p style={styles.text}>
            Paid subscriptions are billed in advance on a monthly or annual basis.
            Payment processing is handled by Stripe. By providing payment information,
            you authorize us to charge your payment method for all fees incurred.
          </p>

          <h3 style={styles.subheading}>Cancellation</h3>
          <p style={styles.text}>
            You may cancel your subscription at any time through your account settings or
            the Stripe billing portal. Cancellation takes effect at the end of the current
            billing period. No refunds are provided for partial months.
          </p>

          <h3 style={styles.subheading}>Price Changes</h3>
          <p style={styles.text}>
            We may modify pricing with 30 days advance notice. Continued use after the
            notice period constitutes acceptance of the new pricing.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>6. Intellectual Property / Geistiges Eigentum</h2>
          <p style={styles.text}>
            The Service and its original content, features, and functionality are owned by
            Meetropolis and are protected by international copyright, trademark, and other
            intellectual property laws.
          </p>
          <p style={styles.text}>
            The core platform is released under the Apache License 2.0. You may use, modify,
            and distribute the open-source components in accordance with that license.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>7. User Content / Nutzerinhalte</h2>
          <p style={styles.text}>
            You retain ownership of any content you create or upload to the Service.
            By posting content, you grant us a limited license to store, display, and
            transmit that content as necessary to provide the Service.
          </p>
          <p style={styles.text}>
            You are solely responsible for the content you share and must ensure it
            complies with applicable laws and these Terms.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>8. Service Availability / Verfugbarkeit</h2>
          <p style={styles.text}>
            We strive to provide reliable service but do not guarantee uninterrupted availability.
            The Service may be temporarily unavailable due to maintenance, updates, or circumstances
            beyond our control.
          </p>
          <p style={styles.text}>
            We reserve the right to modify, suspend, or discontinue the Service at any time
            with reasonable notice.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>9. Limitation of Liability / Haftungsbeschrankung</h2>
          <p style={styles.text}>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, MEETROPOLIS SHALL NOT BE LIABLE FOR ANY
            INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS
            OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY.
          </p>
          <p style={styles.text}>
            Our total liability for any claims under these Terms shall not exceed the amount
            paid by you for the Service in the twelve (12) months prior to the claim.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>10. Disclaimer of Warranties / Gewahrleistungsausschluss</h2>
          <p style={styles.text}>
            THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND,
            EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF
            MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>11. Indemnification / Freistellung</h2>
          <p style={styles.text}>
            You agree to indemnify, defend, and hold harmless Meetropolis and its officers,
            directors, employees, and agents from any claims, damages, losses, or expenses
            arising from your use of the Service or violation of these Terms.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>12. Termination / Kundigung</h2>
          <p style={styles.text}>
            We may terminate or suspend your account immediately, without prior notice,
            for conduct that we believe violates these Terms or is harmful to other users,
            us, or third parties, or for any other reason at our sole discretion.
          </p>
          <p style={styles.text}>
            Upon termination, your right to use the Service will immediately cease.
            Provisions that by their nature should survive termination will remain in effect.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>13. Governing Law / Anwendbares Recht</h2>
          <p style={styles.text}>
            These Terms shall be governed by and construed in accordance with the laws of
            the Federal Republic of Germany, without regard to its conflict of law provisions.
          </p>
          <p style={styles.text}>
            Any disputes arising from these Terms shall be subject to the exclusive jurisdiction
            of the courts in [Your City], Germany.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>14. Changes to Terms / Anderungen</h2>
          <p style={styles.text}>
            We reserve the right to modify these Terms at any time. We will notify users of
            material changes via email or in-app notification at least 30 days before the
            changes take effect.
          </p>
          <p style={styles.text}>
            Your continued use of the Service after changes become effective constitutes
            acceptance of the revised Terms.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>15. Contact / Kontakt</h2>
          <p style={styles.text}>
            For questions about these Terms, please contact us at:<br />
            Email: <a href="mailto:legal@meetropolis.de" style={styles.link}>legal@meetropolis.de</a>
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>16. Severability / Salvatorische Klausel</h2>
          <p style={styles.text}>
            If any provision of these Terms is found to be unenforceable, the remaining
            provisions will continue in full force and effect.
          </p>
        </section>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: 'var(--bg, #0a0a0a)',
    color: 'var(--fg, #fff)',
    padding: '40px 20px',
  },
  content: {
    maxWidth: 800,
    margin: '0 auto',
  },
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--accent, #3b82f6)',
    fontSize: 14,
    cursor: 'pointer',
    marginBottom: 24,
    padding: 0,
  },
  title: {
    fontSize: 32,
    fontWeight: 700,
    marginBottom: 8,
    color: 'var(--fg, #fff)',
  },
  lastUpdated: {
    fontSize: 14,
    color: 'var(--fg-subtle, #888)',
    marginBottom: 40,
  },
  section: {
    marginBottom: 32,
  },
  heading: {
    fontSize: 20,
    fontWeight: 600,
    marginBottom: 12,
    color: 'var(--fg, #fff)',
  },
  subheading: {
    fontSize: 16,
    fontWeight: 600,
    marginTop: 16,
    marginBottom: 8,
    color: 'var(--fg, #fff)',
  },
  text: {
    fontSize: 15,
    lineHeight: 1.7,
    color: 'var(--fg-subtle, #ccc)',
    marginBottom: 12,
  },
  list: {
    fontSize: 15,
    lineHeight: 1.8,
    color: 'var(--fg-subtle, #ccc)',
    paddingLeft: 24,
    marginBottom: 12,
  },
  link: {
    color: 'var(--accent, #3b82f6)',
    textDecoration: 'none',
  },
};

export default TermsOfService;
