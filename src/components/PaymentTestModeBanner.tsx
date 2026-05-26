import { getPaddleEnvironment, isPaddleConfigured } from "@/lib/paddle";

export function PaymentTestModeBanner() {
  if (!isPaddleConfigured()) return null;
  if (getPaddleEnvironment() !== "sandbox") return null;
  return (
    <div className="w-full bg-orange-100 border-b border-orange-300 px-4 py-2 text-center text-xs text-orange-800 dark:bg-orange-950/40 dark:text-orange-200 dark:border-orange-900">
      Card payments are in test mode. Use card 4242 4242 4242 4242 with any CVC and future expiry.
    </div>
  );
}
