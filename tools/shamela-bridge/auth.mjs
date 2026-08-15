// Bridge session token — trust-on-first-use pairing.
//
// The bridge has no auth today: CORS/PNA/Host-header checks stop a browser
// on the wrong origin, but none of that applies to a plain local process
// (curl, another app) — anything on the machine can already read the user's
// whole Shamela library over this unauthenticated HTTP server. A token
// closes that gap without asking the user to do anything by hand:
//
// - On the machine's first-ever bridge run, no token file exists yet.
//   `/health` (the one endpoint every client already calls to check
//   connectivity, before it has any token) reveals a freshly generated
//   token in that response — exactly once, ever, since it is written to
//   disk immediately and `/health` never reveals a token that already
//   exists on disk, on this run or any later restart.
// - Every other endpoint requires that token in `X-Bridge-Token`.
//
// This is not a defence against something already running as the user
// (nothing local-HTTP-only can be) — it closes the specific gap of a
// silent, unauthenticated bystander process reading the library without
// the user ever having connected anything. If pairing is ever lost or
// suspected compromised, deleting the token file and restarting the bridge
// re-arms the one-time reveal.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, '.bridge-token.json');

const hadTokenBeforeThisRun = fs.existsSync(TOKEN_FILE);

function loadOrCreateToken() {
  if (hadTokenBeforeThisRun) {
    try {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      if (typeof data.token === 'string' && data.token.length >= 32) return data.token;
    } catch {
      // Corrupt file — fall through and mint a new one below.
    }
  }
  const token = randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2), {
    mode: 0o600,
  });
  return token;
}

export const BRIDGE_TOKEN = loadOrCreateToken();

// `hadTokenBeforeThisRun` alone only guards across restarts — within a
// single run every /health call would otherwise keep re-revealing the token
// to whichever process asks. This flips after the very first reveal, so at
// most one request, ever, sees it.
let revealed = hadTokenBeforeThisRun; // already "used up" if the file predates this run

/** Returns the token exactly once across this file's entire history — the
 *  first call after a fresh install — and `null` on every call after that,
 *  including later restarts. */
export function takeRevealOnceToken() {
  if (revealed) return null;
  revealed = true;
  return BRIDGE_TOKEN;
}

export function isAuthorized(req) {
  const header = req.headers['x-bridge-token'];
  return typeof header === 'string' && header === BRIDGE_TOKEN;
}
