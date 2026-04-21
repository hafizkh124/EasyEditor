import { useMemo } from "react";
import { useSubscription } from "@/contexts/SubscriptionContext";

/**
 * Kinds of per-tier quotas enforced in the UI. Each maps to a pair of
 * `{kind}_used` and `{kind}_limit` columns on `subscriptions` (with the
 * kind-specific column names wired up internally).
 */
export type QuotaKind =
  | "transcription"    // seconds
  | "tts"              // characters
  | "ocr"              // pages
  | "research"         // queries
  | "islamic";         // queries

type SubscriptionLike = Record<string, number | null | undefined> | null | undefined;

const USED_COLUMN: Record<QuotaKind, string> = {
  transcription: "transcription_seconds_used",
  tts: "tts_characters_used",
  ocr: "ocr_pages_used",
  research: "research_queries_used",
  islamic: "islamic_queries_used",
};

const LIMIT_COLUMN: Record<QuotaKind, string> = {
  transcription: "transcription_limit",
  tts: "tts_character_limit",
  ocr: "ocr_pages_limit",
  research: "research_queries_limit",
  islamic: "islamic_queries_limit",
};

function readNumber(sub: SubscriptionLike, col: string): number {
  const v = sub?.[col];
  return typeof v === "number" ? v : 0;
}

/**
 * Centralized quota check.
 *
 * Convention across the app: `limit === 0` means "feature disabled for this
 * tier" and should NOT be treated as "limit reached" — the UI shows a
 * dedicated "upgrade required" state in that case. Only `limit > 0 && used >= limit`
 * counts as reached.
 *
 * Pass `extraUsed` to include optimistic in-session usage not yet persisted
 * to the subscription row (e.g., TTS characters spoken this session).
 */
export function useLimitReached(kind: QuotaKind, extraUsed = 0) {
  const { subscription } = useSubscription();

  return useMemo(() => {
    const sub = subscription as SubscriptionLike;
    const used = readNumber(sub, USED_COLUMN[kind]) + extraUsed;
    const limit = readNumber(sub, LIMIT_COLUMN[kind]);
    const reached = limit > 0 && used >= limit;
    const unavailable = limit === 0; // tier doesn't include this feature
    return { used, limit, reached, unavailable };
  }, [subscription, kind, extraUsed]);
}
