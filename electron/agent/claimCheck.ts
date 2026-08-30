/**
 * M8 Layer 6 — the claim-check tier for `insert_footnote` (SPEC-M8 §3
 * "Review gate", ADR-0019 item 6).
 *
 * ONE lightweight Gemini call: does the retrieved excerpt actually support
 * the sentence the agent wants to footnote? Not a separate verifier agent —
 * this runs inside the one tool call. A model/network failure here is
 * non-fatal: it degrades to "no opinion" (returns supports:true with a note)
 * so a transient error never blocks a footnote whose deterministic integrity
 * gate already passed.
 */
import { getDecryptedGeminiKey } from '../ai/keyStore.js';
import { logger } from '../lib/logger.js';
import type { ClaimVerdict } from '../../shared/agent/grounding.js';

const log = logger.child('agent/claimCheck');

export async function checkClaim(claim: string, excerpt: string): Promise<ClaimVerdict> {
  const key = await getDecryptedGeminiKey();
  if (!key) return { supports: true, note: 'claim not checked (no API key)' };

  const prompt =
    'You are checking whether a source supports a claim in a scholarly document.\n\n' +
    `CLAIM: ${claim.slice(0, 600)}\n\n` +
    `SOURCE EXCERPT: ${excerpt.slice(0, 2000)}\n\n` +
    'Answer with ONLY a compact JSON object: {"supports": true|false, "note": "<=15 words"}. ' +
    '"supports" is true only if the excerpt directly backs the claim; false if it is off-topic, ' +
    'contradicts it, or is too vague to support it.';

  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    const parsed = JSON.parse(text) as { supports?: unknown; note?: unknown };
    return {
      supports: parsed.supports !== false,
      note: typeof parsed.note === 'string' ? parsed.note.slice(0, 120) : '',
    };
  } catch (err) {
    log.warn('claim check failed — not blocking the footnote', { message: (err as Error).message });
    return { supports: true, note: 'claim check unavailable' };
  }
}
