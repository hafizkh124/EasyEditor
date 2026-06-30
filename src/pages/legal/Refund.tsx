import LegalLayout from "./LegalLayout";

export default function Refund() {
  return (
    <LegalLayout
      title="Refund Policy"
      titleAr="سياسة الاسترداد"
      description="30-day money-back guarantee for Al-Ulama Easy Editor subscriptions and unused token packs."
      descriptionAr="ضمان استرداد المال خلال 30 يومًا لاشتراكات Al-Ulama Easy Editor وأرصدة الرموز غير المُستهلكة."
      path="/refund-policy"
      slug="refund"
      lastUpdated="26 May 2026"
    >
      <p>
        We want you to be happy with <strong>Al-Ulama Easy Editor</strong>. If for any reason
        you are not satisfied, we offer a <strong>30-day money-back guarantee</strong> as
        described below.
      </p>

      <h2>1. Subscriptions (Manual Bank / Wallet Transfers)</h2>
      <ul>
        <li>You may request a full refund of your most recent monthly subscription payment within <strong>30 days</strong> of the payment date.</li>
        <li>Renewal payments are independently refundable within 30 days of each renewal.</li>
        <li>Refunds are processed back to the original sending bank account or mobile-wallet number that was used for the transfer.</li>
        <li>To request a refund, email <a href="mailto:support@alulama.org">support@alulama.org</a> with the email and transaction reference used for payment.</li>
      </ul>

      <h2>2. One-Time Token Top-Ups</h2>
      <ul>
        <li>Unused tokens may be refunded within 30 days of purchase on a pro-rata basis (refund = paid amount × unused tokens / purchased tokens).</li>
        <li>Tokens that have already been consumed are non-refundable.</li>
      </ul>

      <h2>3. Manual Bank / Mobile-Wallet Payments (PKR)</h2>
      <ul>
        <li>Manual PKR payments are also eligible for a refund within 30 days, processed back to the same bank account or mobile wallet you paid from.</li>
        <li>To request a manual-payment refund, contact us on WhatsApp <a href="https://wa.me/923290010282">+92 329 0010282</a> or email <a href="mailto:support@alulama.org">support@alulama.org</a> with your transaction reference.</li>
      </ul>

      <h2>4. How Refunds Are Processed</h2>
      <ul>
        <li>Approved card refunds appear on your statement within 5–10 business days, depending on your bank.</li>
        <li>Approved manual refunds are sent within 3 business days of approval.</li>
        <li>On refund, your subscription is canceled and access ends immediately. Outstanding tokens are zeroed.</li>
      </ul>

      <h2>5. Cancellations Without Refund</h2>
      <p>
        You can cancel a subscription at any time without requesting a refund. You keep access
        until the end of the current billing period and are not charged again.
      </p>

      <h2>6. Exceptions</h2>
      <p>
        We reserve the right to decline a refund where we reasonably suspect abuse of the
        money-back guarantee (e.g. repeated refund requests, evidence of fraud, or violation
        of the <a href="/terms">Terms of Service</a> Acceptable Use rules).
      </p>

      <h2>7. Contact</h2>
      <p>
        Email: <a href="mailto:support@alulama.org">support@alulama.org</a><br />
        WhatsApp: <a href="https://wa.me/923290010282">+92 329 0010282</a>
      </p>
    </LegalLayout>
  );
}
