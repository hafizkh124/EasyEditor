import LegalLayout from "./LegalLayout";
import { Link } from "react-router-dom";
import { PLAN_TIERS, buildFeatures } from "@/lib/planTiers";
import { useLanguage } from "@/contexts/LanguageContext";
import { Check, X, CreditCard, Clock, Zap } from "lucide-react";

/**
 * Public, unauthenticated pricing page required by Paddle verification.
 * Shows full catalog + the two payment channels (card = instant, manual = approval delay).
 */
export default function PricingInfo() {
  const { t } = useLanguage();

  return (
    <LegalLayout
      title="Pricing"
      description="Plans, token top-ups and payment methods for Al-Ulama Easy Editor — pay by card for instant activation, or by manual PKR transfer."
      path="/pricing-info"
      lastUpdated="26 May 2026"
    >
      <p>
        <strong>Al-Ulama Easy Editor</strong> is an AI-powered Islamic research, transcription
        (speech-to-text), OCR and text-to-speech editor for Urdu, Arabic and English. We sell
        monthly subscriptions and one-time token top-ups. All prices are listed below in both
        US Dollars (card) and Pakistani Rupees (manual transfer).
      </p>

      <h2>Two ways to pay</h2>
      <div className="not-prose grid gap-4 sm:grid-cols-2 my-6">
        <div className="rounded-2xl border-2 border-primary/50 bg-primary/5 p-5">
          <div className="flex items-center gap-2 mb-2 text-primary font-semibold">
            <CreditCard className="h-5 w-5" /> Pay by card — recommended
          </div>
          <ul className="text-sm text-foreground/90 space-y-1.5">
            <li className="flex gap-2"><Zap className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" /> <strong>Instant activation</strong> — your account is upgraded within seconds.</li>
            <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" /> Auto-renews monthly. Cancel anytime, no questions asked.</li>
            <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" /> Lower price (USD) — no manual handling fee.</li>
            <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" /> Self-serve invoices, refunds and cancellation via paddle.net.</li>
            <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" /> Processed by <strong>Paddle</strong> (our Merchant of Record).</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-2 font-semibold">
            <Clock className="h-5 w-5 text-amber-500" /> Manual bank / wallet transfer (PKR)
          </div>
          <ul className="text-sm text-foreground/90 space-y-1.5">
            <li className="flex gap-2"><Clock className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" /> <strong>Manual approval — 1 to 2 business days</strong> before your account is activated.</li>
            <li className="flex gap-2"><X className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" /> Does not auto-renew — you must submit a new payment each cycle.</li>
            <li className="flex gap-2"><X className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" /> Higher PKR price to cover manual processing.</li>
            <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" /> Suitable if your card does not work for international transactions.</li>
          </ul>
        </div>
      </div>

      <h2>Subscription plans</h2>
      <div className="not-prose overflow-x-auto my-4">
        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-start p-3">Plan</th>
              <th className="text-start p-3">Card price (instant)</th>
              <th className="text-start p-3">Manual PKR (1–2 days)</th>
              <th className="text-start p-3">Included monthly</th>
            </tr>
          </thead>
          <tbody>
            {PLAN_TIERS.map((tier) => {
              const features = buildFeatures(tier.featureTemplates, t).filter(f => f.included);
              const cardUsd = tier.id === "basic" ? "$5" : tier.id === "pro" ? "$19" : "$29";
              const manualPkr = tier.id === "basic" ? "1,800 PKR" : tier.id === "pro" ? "6,500 PKR" : "9,500 PKR";
              return (
                <tr key={tier.id} className="border-t border-border">
                  <td className="p-3 font-semibold capitalize">{tier.id}{tier.popular ? " ⭐" : ""}</td>
                  <td className="p-3 text-primary font-semibold">{cardUsd} / month</td>
                  <td className="p-3 text-muted-foreground">{manualPkr} / month</td>
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
              <th className="text-start p-3">Card price (instant)</th>
              <th className="text-start p-3">Manual PKR (1–2 days)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border"><td className="p-3 font-semibold">2,500</td><td className="p-3 text-primary font-semibold">$3</td><td className="p-3 text-muted-foreground">950 PKR</td></tr>
            <tr className="border-t border-border"><td className="p-3 font-semibold">10,000</td><td className="p-3 text-primary font-semibold">$10</td><td className="p-3 text-muted-foreground">3,200 PKR</td></tr>
            <tr className="border-t border-border"><td className="p-3 font-semibold">25,000</td><td className="p-3 text-primary font-semibold">$20</td><td className="p-3 text-muted-foreground">6,200 PKR</td></tr>
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
        Card prices are exclusive of any local sales tax / VAT. Taxes (if applicable in your
        country) are calculated and collected by Paddle at checkout.
      </p>

      <h2>Refunds &amp; cancellation</h2>
      <p>
        See our <Link to="/refund-policy">Refund Policy</Link> — 30-day money-back guarantee
        on both payment channels. Cancel a card subscription anytime via{" "}
        <a href="https://paddle.net" target="_blank" rel="noopener noreferrer">paddle.net</a>
        {" "}or from your in-app Settings page.
      </p>

      <h2>Ready to start?</h2>
      <p>
        <Link to="/signup" className="text-primary font-semibold">Create a free account →</Link>
      </p>
    </LegalLayout>
  );
}
