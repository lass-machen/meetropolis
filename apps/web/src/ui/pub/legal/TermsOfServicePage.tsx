import { useTranslation } from 'react-i18next';
import { LegalLayout } from './LegalLayout';

interface TermsOfServicePageProps {
  onBack: () => void;
}

export function TermsOfServicePage({ onBack }: TermsOfServicePageProps) {
  const { t } = useTranslation('public');
  const navigate = (route: string) => {
    window.location.hash = `#/${route}`;
  };

  const sections = [
    {
      id: 'zustimmung',
      title: 'Zustimmung',
      content: (
        <div>
          <p>
            By accessing or using Meetropolis ("Service"), you agree to be
            bound by these Terms of Service ("Terms"). If you disagree with
            any part of these terms, you may not access the Service.
          </p>
          <p>
            Mit dem Zugriff auf oder der Nutzung von Meetropolis ("Dienst")
            erklären Sie sich mit diesen Nutzungsbedingungen ("Bedingungen")
            einverstanden. Wenn Sie mit einem Teil dieser Bedingungen nicht
            einverstanden sind, dürfen Sie den Dienst nicht nutzen.
          </p>
        </div>
      ),
    },
    {
      id: 'beschreibung',
      title: 'Beschreibung des Dienstes',
      content: (
        <div>
          <p>
            Meetropolis is a virtual office platform that enables teams to
            collaborate through avatar-based presence, audio/video
            communication, and real-time interactions.
          </p>
          <p>We offer:</p>
          <ul>
            <li>
              <strong>Free Tier:</strong> Self-hosted version with 25
              concurrent user limit
            </li>
            <li>
              <strong>Paid Plans:</strong> Hosted service with various user
              limits and features
            </li>
            <li>
              <strong>Enterprise:</strong> Custom solutions with unlimited
              users
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'benutzerkonten',
      title: 'Benutzerkonten',
      content: (
        <div>
          <p>
            To use certain features of the Service, you must register for an
            account. You agree to:
          </p>
          <ul>
            <li>Provide accurate and complete registration information</li>
            <li>Maintain the security of your password and account</li>
            <li>Promptly notify us of any unauthorized access</li>
            <li>Accept responsibility for all activities under your account</li>
          </ul>
          <p>You must be at least 16 years old to create an account.</p>
        </div>
      ),
    },
    {
      id: 'zulaessige-nutzung',
      title: 'Zulässige Nutzung',
      content: (
        <div>
          <p>You agree NOT to use the Service to:</p>
          <ul>
            <li>Violate any applicable laws or regulations</li>
            <li>Infringe intellectual property rights of others</li>
            <li>Harass, abuse, or harm other users</li>
            <li>Transmit malware, spam, or malicious content</li>
            <li>Attempt to gain unauthorized access to systems</li>
            <li>Interfere with or disrupt the Service</li>
            <li>Resell or redistribute the Service without authorization</li>
            <li>Use the Service for illegal activities</li>
          </ul>
          <p>
            Violation of these terms may result in immediate account
            termination.
          </p>
        </div>
      ),
    },
    {
      id: 'abonnements',
      title: 'Abonnements und Zahlung',
      content: (
        <div>
          <h3>Billing</h3>
          <p>
            Paid subscriptions are billed in advance on a monthly or annual
            basis. Payment processing is handled by Stripe. By providing
            payment information, you authorize us to charge your payment
            method for all fees incurred.
          </p>

          <h3>Cancellation</h3>
          <p>
            You may cancel your subscription at any time through your account
            settings or the Stripe billing portal. Cancellation takes effect
            at the end of the current billing period. No refunds are provided
            for partial months.
          </p>

          <h3>Price Changes</h3>
          <p>
            We may modify pricing with 30 days advance notice. Continued use
            after the notice period constitutes acceptance of the new pricing.
          </p>
        </div>
      ),
    },
    {
      id: 'geistiges-eigentum',
      title: 'Geistiges Eigentum',
      content: (
        <div>
          <p>
            The Service and its original content, features, and functionality
            are owned by Meetropolis and are protected by international
            copyright, trademark, and other intellectual property laws.
          </p>
          <p>
            The core platform is released under the Apache License 2.0. You
            may use, modify, and distribute the open-source components in
            accordance with that license.
          </p>
        </div>
      ),
    },
    {
      id: 'nutzerinhalte',
      title: 'Nutzerinhalte',
      content: (
        <div>
          <p>
            You retain ownership of any content you create or upload to the
            Service. By posting content, you grant us a limited license to
            store, display, and transmit that content as necessary to provide
            the Service.
          </p>
          <p>
            You are solely responsible for the content you share and must
            ensure it complies with applicable laws and these Terms.
          </p>
        </div>
      ),
    },
    {
      id: 'verfuegbarkeit',
      title: 'Verfügbarkeit',
      content: (
        <div>
          <p>
            We strive to provide reliable service but do not guarantee
            uninterrupted availability. The Service may be temporarily
            unavailable due to maintenance, updates, or circumstances beyond
            our control.
          </p>
          <p>
            We reserve the right to modify, suspend, or discontinue the
            Service at any time with reasonable notice.
          </p>
        </div>
      ),
    },
    {
      id: 'haftungsbeschraenkung',
      title: 'Haftungsbeschränkung',
      content: (
        <div>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, MEETROPOLIS SHALL NOT BE
            LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
            PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR REVENUES, WHETHER
            INCURRED DIRECTLY OR INDIRECTLY.
          </p>
          <p>
            Our total liability for any claims under these Terms shall not
            exceed the amount paid by you for the Service in the twelve (12)
            months prior to the claim.
          </p>
        </div>
      ),
    },
    {
      id: 'gewaehrleistung',
      title: 'Gewährleistungsausschluss',
      content: (
        <div>
          <p>
            THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT
            WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT
            NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR
            A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
          </p>
        </div>
      ),
    },
    {
      id: 'freistellung',
      title: 'Freistellung',
      content: (
        <div>
          <p>
            You agree to indemnify, defend, and hold harmless Meetropolis and
            its officers, directors, employees, and agents from any claims,
            damages, losses, or expenses arising from your use of the Service
            or violation of these Terms.
          </p>
        </div>
      ),
    },
    {
      id: 'kuendigung',
      title: 'Kündigung',
      content: (
        <div>
          <p>
            We may terminate or suspend your account immediately, without
            prior notice, for conduct that we believe violates these Terms or
            is harmful to other users, us, or third parties, or for any other
            reason at our sole discretion.
          </p>
          <p>
            Upon termination, your right to use the Service will immediately
            cease. Provisions that by their nature should survive termination
            will remain in effect.
          </p>
        </div>
      ),
    },
    {
      id: 'anwendbares-recht',
      title: 'Anwendbares Recht',
      content: (
        <div>
          <p>
            These Terms shall be governed by and construed in accordance with
            the laws of the Federal Republic of Germany, without regard to its
            conflict of law provisions.
          </p>
          <p>
            Any disputes arising from these Terms shall be subject to the
            exclusive jurisdiction of the courts in [Your City], Germany.
          </p>
        </div>
      ),
    },
    {
      id: 'aenderungen',
      title: 'Änderungen',
      content: (
        <div>
          <p>
            We reserve the right to modify these Terms at any time. We will
            notify users of material changes via email or in-app notification
            at least 30 days before the changes take effect.
          </p>
          <p>
            Your continued use of the Service after changes become effective
            constitutes acceptance of the revised Terms.
          </p>
        </div>
      ),
    },
    {
      id: 'kontakt',
      title: 'Kontakt',
      content: (
        <div>
          <p>
            For questions about these Terms, please contact us at:<br />
            Email:{' '}
            <a href="mailto:legal@meetropolis.de">legal@meetropolis.de</a>
          </p>
        </div>
      ),
    },
    {
      id: 'salvatorische-klausel',
      title: 'Salvatorische Klausel',
      content: (
        <div>
          <p>
            If any provision of these Terms is found to be unenforceable, the
            remaining provisions will continue in full force and effect.
          </p>
        </div>
      ),
    },
  ];

  return (
    <LegalLayout
      title={t('legal.termsTitle')}
      subtitle={t('legal.termsSubtitle')}
      breadcrumbLabel={t('legal.termsTitle')}
      lastUpdated="31. März 2026"
      sections={sections}
      onBack={onBack}
      navigate={navigate}
    />
  );
}
