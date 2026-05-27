import LegalLayout from "./LegalLayout";

export default function Privacy() {
  return (
    <LegalLayout
      title="Privacy Notice"
      description="How Al-Ulama Easy Editor collects, uses and shares your personal data."
      path="/privacy"
      lastUpdated="26 May 2026"
    >
      <p>
        This Privacy Notice describes how <strong>Hafiz Khizar Hayat</strong> (trading as{" "}
        <strong>Al-Ulama</strong>), the operator of <strong>Al-Ulama Easy Editor</strong>
        (the <strong>"Service"</strong>), collects, uses and shares your personal data. We
        act as the <strong>data controller</strong> for personal data processed in connection
        with the Service.
      </p>

      <h2>1. Personal Data We Collect</h2>
      <ul>
        <li><strong>Account data:</strong> name, email address, password (hashed), profile picture, language preference, country.</li>
        <li><strong>Content you submit:</strong> audio uploads, images/PDFs for OCR, research queries, prompts and generated outputs.</li>
        <li><strong>Usage &amp; telemetry:</strong> feature usage, token consumption, error logs, device and browser metadata, IP address, approximate location derived from IP.</li>
        <li><strong>Support &amp; communications:</strong> messages you send us via WhatsApp, email or the in-app contact form.</li>
        <li><strong>Manual-payment data:</strong> bank/mobile-wallet transaction references you submit for manual approval.</li>
        <li><strong>Card-payment data:</strong> collected directly by our payment partner SafePay. We never see or store your full card details.</li>
      </ul>

      <h2>2. Why We Use Your Data &amp; Legal Basis</h2>
      <table>
        <thead>
          <tr><th>Purpose</th><th>Legal basis</th></tr>
        </thead>
        <tbody>
          <tr><td>Creating and managing your account</td><td>Contract performance</td></tr>
          <tr><td>Providing AI features (transcription, OCR, research, TTS)</td><td>Contract performance</td></tr>
          <tr><td>Processing payments and issuing receipts</td><td>Contract performance / legal obligation</td></tr>
          <tr><td>Preventing fraud, abuse and security incidents</td><td>Legitimate interests</td></tr>
          <tr><td>Improving the Service and debugging</td><td>Legitimate interests</td></tr>
          <tr><td>Customer support</td><td>Contract performance</td></tr>
          <tr><td>Sending service announcements and (with consent) marketing</td><td>Legitimate interests / consent</td></tr>
        </tbody>
      </table>

      <h2>3. Who We Share Data With</h2>
      <ul>
        <li>
          <strong>SafePay (Pakistan):</strong> our payment gateway for card and wallet
          (Easypaisa, JazzCash) transactions. SafePay processes payment information securely
          under PCI-DSS. See{" "}
          <a href="https://getsafepay.com/privacy" target="_blank" rel="noopener noreferrer">SafePay's Privacy Notice</a>.
        </li>
        <li>
          <strong>Hosting &amp; backend (Supabase, Vercel/Lovable infrastructure):</strong>
          provide database, file storage, authentication and edge-compute hosting.
        </li>
        <li>
          <strong>AI providers (Google, OpenAI, ElevenLabs):</strong> process audio, text and
          images solely to generate the requested Outputs. They are bound by their own privacy
          and data-handling commitments.
        </li>
        <li><strong>Email delivery providers:</strong> for transactional and account emails.</li>
        <li><strong>Professional advisers:</strong> legal, accounting, where required.</li>
        <li><strong>Government authorities:</strong> where required by law, court order or to protect our rights.</li>
      </ul>
      <p>We do not sell your personal data.</p>

      <h2>4. International Transfers</h2>
      <p>
        Our service providers are located worldwide, including the EU, UK, US and other
        jurisdictions. When personal data is transferred outside your country we rely on
        standard contractual clauses, adequacy decisions or other lawful transfer mechanisms.
      </p>

      <h2>5. Retention</h2>
      <ul>
        <li><strong>Account data:</strong> kept while your account is active and for up to 12 months after deletion (or longer where law requires).</li>
        <li><strong>Audio/image uploads:</strong> processed and then deleted automatically from temporary storage; transcripts/outputs are kept in your account history until you delete them.</li>
        <li><strong>Payment records:</strong> kept for 7 years for tax and accounting purposes.</li>
        <li><strong>Logs:</strong> typically 90 days.</li>
      </ul>

      <h2>6. Your Rights</h2>
      <p>Depending on your country, you may have the right to:</p>
      <ul>
        <li>access the personal data we hold about you;</li>
        <li>request correction of inaccurate data;</li>
        <li>request erasure of your data;</li>
        <li>restrict or object to certain processing;</li>
        <li>data portability;</li>
        <li>withdraw consent where processing is based on consent;</li>
        <li>lodge a complaint with your local supervisory authority.</li>
      </ul>
      <p>
        To exercise any of these rights, email{" "}
        <a href="mailto:support@alulama.org">support@alulama.org</a>. We respond within 30
        days.
      </p>

      <h2>7. Security</h2>
      <p>
        We implement appropriate technical and organisational measures including encryption in
        transit (HTTPS/TLS) and at rest, role-based access controls, row-level security on the
        database, and regular dependency updates. No system is perfectly secure; please notify
        us immediately if you suspect unauthorised access to your account.
      </p>

      <h2>8. Cookies</h2>
      <p>
        We use only strictly necessary cookies and local storage (authentication session,
        language preference, theme, recent activity log). We do not use third-party analytics
        or advertising cookies. The Paddle checkout overlay sets its own cookies governed by
        Paddle's privacy notice.
      </p>

      <h2>9. Children</h2>
      <p>
        The Service is not directed at children under 13. We do not knowingly collect personal
        data from children. If you believe a child has provided us with personal data, contact
        us and we will delete it.
      </p>

      <h2>10. Changes to this Notice</h2>
      <p>
        We may update this Notice from time to time. Material changes will be notified by
        email or in-app.
      </p>

      <h2>11. Contact</h2>
      <p>
        Hafiz Khizar Hayat (trading as Al-Ulama)<br />
        Email: <a href="mailto:support@alulama.org">support@alulama.org</a><br />
        WhatsApp: <a href="https://wa.me/923290010282">+92 329 0010282</a>
      </p>
    </LegalLayout>
  );
}
