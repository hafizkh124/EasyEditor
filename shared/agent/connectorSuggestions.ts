/**
 * Composer suggestions (ADR-0062) — "this looks like a hadith question; turn
 * on «Hadith»?". Reuses `matchDomains`, the keyword map the agent's own intent
 * gate uses, so the card and the agent never disagree about what a question
 * is about.
 *
 * Only connectors that are currently OFF are returned, at most two, and never
 * an Advanced one (the Shamela transports — Turath already covers every
 * device). Nothing here enables anything: the caller shows a card and the
 * scholar clicks.
 *
 * Pure — no runtime globals.
 */
import { connectorById } from './connectors.js';
import { matchDomains } from './toolScoping.js';

const MAX_SUGGESTIONS = 2;

/** Shorter text has too little to match on and would suggest from a stray word. */
const MIN_LENGTH = 6;

export function suggestConnectors(
  text: string,
  isOn: (id: string) => boolean,
  dismissed: ReadonlySet<string> = new Set(),
): string[] {
  const ask = text.trim();
  if (ask.length < MIN_LENGTH) return [];

  const out: string[] = [];
  for (const rule of matchDomains(ask)) {
    const id = rule.connector;
    if (!id || out.includes(id)) continue;
    const connector = connectorById(id);
    if (!connector || connector.advanced) continue;
    if (isOn(id) || dismissed.has(id)) continue;
    out.push(id);
    if (out.length === MAX_SUGGESTIONS) break;
  }
  return out;
}
