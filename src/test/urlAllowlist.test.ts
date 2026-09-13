// @vitest-environment node
// SPEC-M5 FR-2.2 — `shell.openExternal` is a security boundary: whatever host
// list `isAllowedExternalUrl` enforces is the complete set of places a renderer
// script, a navigation event, or an IPC caller can make the user's real browser
// open. Both callers (electron/main.ts's window-open interception and
// electron/ipc/systemHandlers.ts's open-external channel) delegate to it, so a
// regression here widens both at once — silently, because nothing about the app
// looks different when the allowlist gets too permissive.
//
// These tests are deliberately adversarial. They are not asserting that the
// current implementation is clever; they exist so that a future rewrite (a
// switch to `endsWith`, a regex, a "just allow subdomains" convenience) fails
// here instead of in the wild.
import { describe, it, expect, vi, afterEach } from "vitest";
import { isAllowedExternalUrl } from "../../electron/lib/urlAllowlist";

describe("isAllowedExternalUrl — allowed hosts", () => {
  it.each([
    ["https://shamela.ws/book/1", "shamela.ws"],
    ["https://github.com/hafizkh124/EasyEditor", "github.com"],
    ["https://aistudio.google.com/app/apikey", "aistudio.google.com"],
    ["https://huggingface.co/ggerganov/whisper.cpp", "huggingface.co"],
    ["https://editor.alulama.org/connect-device?code=ABCDEFGH", "editor.alulama.org"],
  ])("allows %s", (url, hostname) => {
    const parsed = isAllowedExternalUrl(url);
    expect(parsed).not.toBeNull();
    expect(parsed!.hostname).toBe(hostname);
  });

  it("returns the parsed URL, not merely a boolean", () => {
    // Callers pass `parsed.toString()` on to shell.openExternal rather than the
    // raw input, so the return value has to be a usable URL.
    const parsed = isAllowedExternalUrl("https://shamela.ws/book/1?page=2#x");
    expect(parsed).toBeInstanceOf(URL);
    expect(parsed!.toString()).toBe("https://shamela.ws/book/1?page=2#x");
  });

  it("allows the configured Supabase host", () => {
    // vitest.config.ts pins VITE_SUPABASE_URL to https://test.supabase.invalid,
    // which the module reads at import time. This asserts the host is derived
    // from config rather than hard-coded — the reason the OAuth redirect works.
    expect(isAllowedExternalUrl("https://test.supabase.invalid/auth/v1/authorize")).not.toBeNull();
  });
});

describe("isAllowedExternalUrl — rejected schemes", () => {
  it.each([
    // http is not a typo for https: an allowlisted host reached over http is a
    // downgrade the user never asked for.
    "http://shamela.ws/book/1",
    "file:///C:/Windows/System32/cmd.exe",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "ftp://shamela.ws/x",
    // Electron treats these as openable targets; none belong on this path.
    "ms-msdt:/id",
    "shell:startup",
  ])("rejects %s", (url) => {
    expect(isAllowedExternalUrl(url)).toBeNull();
  });

  it("rejects a scheme-relative URL", () => {
    // `//evil.com/x` has no base here, so it must fail to parse rather than
    // inherit one.
    expect(isAllowedExternalUrl("//evil.com/x")).toBeNull();
  });
});

describe("isAllowedExternalUrl — host spoofing", () => {
  it.each([
    // Suffix: an `endsWith` implementation would let all of these through.
    "https://shamela.ws.evil.com/x",
    "https://github.com.evil.com/x",
    "https://editor.alulama.org.evil.com/x",
    // Prefix / infix.
    "https://evil-shamela.ws/x",
    "https://evilshamela.ws/x",
    // Subdomain: not allowlisted, and must not be inferred from the parent.
    "https://raw.github.com/x",
    "https://api.shamela.ws/x",
    // Userinfo — `https://github.com@evil.com/` has hostname evil.com.
    "https://github.com@evil.com/x",
    "https://shamela.ws:pass@evil.com/x",
    // Lookalike TLD.
    "https://shamela.wss/x",
    "https://github.co/x",
  ])("rejects %s", (url) => {
    expect(isAllowedExternalUrl(url)).toBeNull();
  });

  it("rejects an unrelated host outright", () => {
    expect(isAllowedExternalUrl("https://example.com")).toBeNull();
  });

  it("is not fooled by a non-standard port on an allowed host", () => {
    // The host is allowlisted, so this one is *permitted* — recorded here so
    // that if the policy ever tightens to default-port-only, the change is
    // deliberate and visible rather than an accident.
    expect(isAllowedExternalUrl("https://shamela.ws:8443/x")).not.toBeNull();
  });
});

describe("isAllowedExternalUrl — malformed input", () => {
  it.each([
    "",
    "   ",
    "not a url",
    "https://",
    "://shamela.ws",
  ])("rejects %o without throwing", (url) => {
    expect(() => isAllowedExternalUrl(url)).not.toThrow();
    expect(isAllowedExternalUrl(url)).toBeNull();
  });

  it("survives values that are not strings at all", () => {
    // systemHandlers.ts guards with `typeof url === 'string'`, but main.ts's
    // window-open path does not — an IPC payload can be anything.
    for (const bad of [null, undefined, 0, {}, []] as unknown[]) {
      expect(() => isAllowedExternalUrl(bad as string)).not.toThrow();
      expect(isAllowedExternalUrl(bad as string)).toBeNull();
    }
  });
});

describe("isAllowedExternalUrl — Supabase host is resolved at import time", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // The host comes from VITE_SUPABASE_URL, which vite.config.ts substitutes into
  // the Electron bundle at build time. The module guards that read, and these
  // two cases are why: a desktop build made without the variable, or with a
  // malformed one, must still open Shamela and GitHub rather than throwing
  // while the module is being imported — an import-time throw in main.ts means
  // the app does not start at all.
  it.each([
    ["missing", undefined],
    ["malformed", "not-a-url"],
    ["empty", ""],
  ])("still allows the static hosts when VITE_SUPABASE_URL is %s", async (_label, value) => {
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", value as string);

    const fresh = await import("../../electron/lib/urlAllowlist");

    expect(fresh.isAllowedExternalUrl("https://shamela.ws/book/1")).not.toBeNull();
    expect(fresh.isAllowedExternalUrl("https://github.com/x")).not.toBeNull();
    // …and nothing extra slipped into the set to compensate.
    expect(fresh.isAllowedExternalUrl("https://test.supabase.invalid/x")).toBeNull();
    expect(fresh.isAllowedExternalUrl("https://example.com")).toBeNull();
  });
});
