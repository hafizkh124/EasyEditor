import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A full-screen page that is not wrapped in AppLayout has no sidebar and no tab
 * bar, so unless it brings its own exit a scholar who lands on it (a link, a
 * saved tab) is stuck. /translate-book/:id shipped that way.
 *
 * Source-level on purpose: it fails the moment a new standalone page is added
 * without one of the exits below, which a render test of one page would not.
 * Every page that sits outside AppLayout must either be in EXITS (and show one
 * of the markers) or be a deliberate flow with its own way out.
 */
const PAGES = join(process.cwd(), "src/pages");

/** Pages that render their own chrome (public layout, workspace top bar) or are one-step flows with a sign-out/cancel. */
const OWN_CHROME: Record<string, string> = {
  Landing: "public site header",
  About: "PublicLayout",
  Answers: "PublicLayout",
  FaqAiHaram: "PublicLayout",
  Workspace: "WorkspaceTopBar has Home",
  Login: "links to signup / forgot password / home",
  Signup: "links to login",
  ForgotPassword: "link back to login",
  ResetPassword: "link back to login",
  NotFound: "Return to Home",
  CompleteProfile: "sign-out button",
  PendingApproval: "sign-out button",
  AccountRejected: "sign-out button",
  CheckoutSuccess: "Dashboard / plan links",
  OAuthConsent: "Deny button",
  TranslationWorkspace: "embedded in the workspace canvas, never standalone",
};

const EXIT_MARKERS = [/AppLayout/, /PublicLayout/, /<PageBack\b/, /<Link\b[^>]*to="\/dashboard"/];

describe("standalone pages have a visible way out", () => {
  const files = readdirSync(PAGES).filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"));

  for (const file of files) {
    const name = file.replace(/\.tsx$/, "");
    it(`${name}`, () => {
      if (OWN_CHROME[name]) return;
      const src = readFileSync(join(PAGES, file), "utf8");
      const ok = EXIT_MARKERS.some((re) => re.test(src));
      expect(ok, `${file} is outside AppLayout with no <PageBack /> or Home link — add one, or list it in OWN_CHROME with the reason`).toBe(true);
    });
  }
});
