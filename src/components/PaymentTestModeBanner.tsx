export function PaymentTestModeBanner() {
  const env = (import.meta.env.VITE_SAFEPAY_ENV as string | undefined) ?? "sandbox";
  if (env === "production") return null;
  return (
    <div className="w-full bg-orange-100 border-b border-orange-300 px-4 py-2 text-center text-xs text-orange-800 dark:bg-orange-950/40 dark:text-orange-200 dark:border-orange-900">
      Card payments are in SafePay <strong>sandbox</strong> mode. Use test card 4000 0000 0000 0002 with any future expiry &amp; CVC.
    </div>
  );
}
