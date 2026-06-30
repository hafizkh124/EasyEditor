import LegalLayout from "./LegalLayout";
import { Link } from "react-router-dom";
import { PLAN_TIERS, buildFeatures } from "@/lib/planTiers";
import { useLanguage } from "@/contexts/LanguageContext";
import { Check, X, Clock, Sparkles, Upload } from "lucide-react";

/**
 * Public, unauthenticated pricing page.
 * Manual receipt upload — system auto-verifies; admin team reviews flagged ones.
 */
export default function PricingInfo() {
  const { t } = useLanguage();

  return (
    <LegalLayout
      title="Pricing"
      titleAr="الأسعار"
      description="Plans, token top-ups and payment methods for Al-Ulama Easy Editor — pay via NBP bank transfer, JazzCash or EasyPaisa with instant system verification."
      descriptionAr="الباقات وشحن الرصيد ووسائل الدفع لـ Al-Ulama Easy Editor — ادفع عبر تحويل NBP أو JazzCash أو EasyPaisa مع تحقّق فوري من النظام."
      path="/pricing-info"
      slug="pricing_info"
      lastUpdated="22 June 2026"
    >
      <p>
        <strong>Al-Ulama Easy Editor</strong> is an Islamic research, transcription
        (speech-to-text), OCR and text-to-speech editor for Urdu, Arabic and English. We sell
        monthly subscriptions and one-time token top-ups — Pakistani users pay in PKR and
        international users pay in USD.
      </p>

      <h2>How payment works</h2>
      <div className="not-prose grid gap-4 sm:grid-cols-2 my-6">
        <div className="rounded-2xl border-2 border-primary/50 bg-primary/5 p-5">
          <div className="flex items-center gap-2 mb-2 text-primary font-semibold">
            <Sparkles className="h-5 w-5" /> Instant system verification (most users)
          </div>
          <ul className="text-sm text-foreground/90 space-y-1.5">
            <li className="flex gap-2"><Upload className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" /> Transfer the fee, then upload a screenshot of the receipt.</li>
            <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" /> Our system verifies the amount, receiver and authenticity.</li>
            <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" /> If valid, your account is activated <strong>instantly</strong>.</li>
            <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" /> Accepts NBP bank transfer, JazzCash and EasyPaisa.</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-2 font-semibold">
            <Clock className="h-5 w-5 text-amber-500" /> Manual team review (if there is any issue)
          </div>
          <ul className="text-sm text-foreground/90 space-y-1.5">
            <li className="flex gap-2"><Clock className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" /> If the receipt is blurry, edited, or doesn't match expectations, our team reviews it manually within 1–2 business days.</li>
            <li className="flex gap-2"><X className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" /> Subscriptions do not auto-renew — a new payment is required each cycle.</li>
            <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" /> You can always reach us on WhatsApp for help.</li>
          </ul>
        </div>
      </div>

      <h2>Subscription plans</h2>
      <div className="not-prose overflow-x-auto my-4">
        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-start p-3">Plan</th>
              <th className="text-start p-3">International (USD)</th>
              <th className="text-start p-3">Pakistan (PKR)</th>
              <th className="text-start p-3">Included monthly</th>
            </tr>
          </thead>
          <tbody>
            {PLAN_TIERS.map((tier) => {
              const features = buildFeatures(tier.featureTemplates, t).filter(f => f.included);
              return (
                <tr key={tier.id} className="border-t border-border">
                  <td className="p-3 font-semibold capitalize">{tier.id}{tier.popular ? " ⭐" : ""}</td>
                  <td className="p-3 text-primary font-semibold">{tier.priceUsd} / month</td>
                  <td className="p-3 text-foreground/90">{tier.price} / month</td>
                  <td className="p-3 text-foreground/90">
                    <ul className="space-y-1">
                      {features.map((f, i) => <li key={i}>• {f.label}</li>)}
                    </ul>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>One-time token top-ups</h2>
      <p>
        Already on a paid plan but ran out of tokens for the month? Top up at any time. Top-ups
        do not auto-renew and unused tokens are refundable within 30 days.
      </p>
      <div className="not-prose overflow-x-auto my-4">
        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-start p-3">Tokens</th>
              <th className="text-start p-3">International (USD)</th>
              <th className="text-start p-3">Pakistan (PKR)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border"><td className="p-3 font-semibold">2,500</td><td className="p-3 text-primary font-semibold">$3</td><td className="p-3 text-foreground/90">950 PKR</td></tr>
            <tr className="border-t border-border"><td className="p-3 font-semibold">10,000</td><td className="p-3 text-primary font-semibold">$10</td><td className="p-3 text-foreground/90">3,200 PKR</td></tr>
            <tr className="border-t border-border"><td className="p-3 font-semibold">25,000</td><td className="p-3 text-primary font-semibold">$20</td><td className="p-3 text-foreground/90">6,200 PKR</td></tr>
          </tbody>
        </table>
      </div>

      <h2>What's included for free</h2>
      <p>
        All registered users get a free tier with limited monthly tokens to try every feature
        before subscribing. No card required to sign up.
      </p>

      <h2>Acceptable use — voice &amp; likeness</h2>
      <p>
        Al-Ulama Easy Editor is built for authentic personal and scholarly work. We do
        <strong> not</strong> offer — and we strictly prohibit — generating images, video, or
        audio that impersonates celebrities, politicians, religious scholars, or any other
        real person. Our text-to-speech feature uses a fixed set of generic synthetic voices.
        Personal voice cloning (where a user uploads a sample of <em>their own</em> voice,
        with full consent, to generate speech in that same voice) is a planned future feature
        and is not currently available; when released it will be limited to the user's own
        voice only. See our <Link to="/terms">Terms of Service</Link> for full details.
      </p>


      <h2>Taxes</h2>
      <p>
        Card / wallet prices are exclusive of any local sales tax / VAT where applicable.
      </p>

      <h2>Refunds &amp; cancellation</h2>
      <p>
        See our <Link to="/refund-policy">Refund Policy</Link> — 30-day money-back guarantee
        on both payment channels. Cancel a subscription anytime from your in-app Settings page
        or by emailing <a href="mailto:support@alulama.org">support@alulama.org</a>.
      </p>

      <h2>Ready to start?</h2>
      <p>
        <Link to="/signup" className="text-primary font-semibold">Create a free account →</Link>
      </p>
    </LegalLayout>
  );
}
