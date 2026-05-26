import { supabase } from "@/integrations/supabase/client";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

declare global {
  interface Window {
    Paddle: any;
  }
}

/** Derived from the token prefix — stays correct after build-time token swap. */
export function getPaddleEnvironment(): "sandbox" | "live" {
  return clientToken?.startsWith("test_") ? "sandbox" : "live";
}

export function isPaddleConfigured(): boolean {
  return !!clientToken;
}

let paddleInitialized = false;
let initPromise: Promise<void> | null = null;

export function initializePaddle(): Promise<void> {
  if (paddleInitialized) return Promise.resolve();
  if (initPromise) return initPromise;
  if (!clientToken) return Promise.reject(new Error("Payments are not configured"));

  initPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-paddle="true"]');
    const onReady = () => {
      try {
        const paddleEnv = getPaddleEnvironment() === "sandbox" ? "sandbox" : "production";
        window.Paddle.Environment.set(paddleEnv);
        window.Paddle.Initialize({ token: clientToken });
        paddleInitialized = true;
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    if (existing && window.Paddle) {
      onReady();
      return;
    }
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
      script.dataset.paddle = "true";
      script.onload = onReady;
      script.onerror = () => reject(new Error("Failed to load Paddle.js"));
      document.head.appendChild(script);
    } else {
      script.addEventListener("load", onReady, { once: true });
    }
  });
  return initPromise;
}

const priceIdCache = new Map<string, string>();

export async function getPaddlePriceId(priceId: string): Promise<string> {
  const cached = priceIdCache.get(priceId);
  if (cached) return cached;
  const environment = getPaddleEnvironment();
  const { data, error } = await supabase.functions.invoke("get-paddle-price", {
    body: { priceId, environment },
  });
  if (error || !data?.paddleId) {
    throw new Error(`Could not resolve price: ${priceId}`);
  }
  priceIdCache.set(priceId, data.paddleId);
  return data.paddleId;
}
