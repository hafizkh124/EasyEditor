import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import ts from "typescript";
import { readSource, relativeSourcePath, sourceFiles } from "./sourceScan";
import {
  CAPABILITIES,
  availableCapabilities,
  isCapabilityAvailable,
  capabilityUnavailableReason,
  type Surface,
} from "@/core/capabilities/registry";
import enTranslations from "@/locales/en.json";

/**
 * The registry exists because "which tools exist on this target" was answered
 * independently in five places and they disagreed. These tests pin down both
 * halves of the fix: the registry says the right thing, and no component is
 * allowed to answer the question for itself again.
 */

const SURFACES: Surface[] = [
  "sidebar", "mobile-nav", "workspace-menu", "dashboard-grid", "command-palette", "workbench-tab",
];

/**
 * Pages that belong to a capability which is itself unavailable on desktop, so
 * their internal links are already gated by the page they sit on. Keep this
 * small — every entry is a place the scanner stops looking.
 */
const WEB_ONLY_FEATURE_PAGES = new Set([
  "src/pages/OCR.tsx",
  // The page's workflow moved into this hook; the "listen to the result"
  // hand-off to /speak went with it. Same gate applies — OCR is desktop:never,
  // so nothing here renders on a runtime where /speak might be missing.
  "src/pages/ocr/useOcrWorkflow.ts",
  "src/pages/OcrReview.tsx",
]);

function asDesktop() {
  (globalThis as { window?: unknown }).window = globalThis.window ?? {};
  (window as unknown as { electronAPI?: unknown }).electronAPI = { isDesktop: true };
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.unstubAllEnvs();
});

describe("capability registry", () => {
  it("gives every routed capability a route that App.tsx actually declares", () => {
    const app = readSource(`${process.cwd()}/src/App.tsx`);
    const declared = new Set([...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));

    for (const capability of CAPABILITIES) {
      if (capability.route === null) continue;
      expect(declared, `${capability.id} -> ${capability.route}`).toContain(capability.route);
    }
  });

  it("labels every capability with a key the locales carry", () => {
    for (const capability of CAPABILITIES) {
      expect(enTranslations, capability.id).toHaveProperty(capability.labelKey);
    }
  });

  it("requires a reason wherever a capability is switched off", () => {
    for (const capability of CAPABILITIES) {
      for (const runtime of ["web", "desktop"] as const) {
        const availability = capability.runtimes[runtime];
        if (availability.on === "never") {
          expect(availability.reason.length, `${capability.id}/${runtime}`).toBeGreaterThan(10);
        }
      }
    }
  });

  describe("on the web", () => {
    it("offers all standalone tools", () => {
      const ids = availableCapabilities("workspace-menu").map((c) => c.id);
      expect(ids).toEqual(expect.arrayContaining(["transcribe", "speak", "ocr", "translate"]));
    });

    it("offers voice cloning and the token meter", () => {
      expect(isCapabilityAvailable("voice.cloning")).toBe(true);
      expect(isCapabilityAvailable("tokens.meter")).toBe(true);
    });
  });

  describe("on the desktop", () => {
    beforeEach(asDesktop);

    it("hides every cloud-only tool on every surface", () => {
      vi.stubEnv("VITE_LOCAL_VOICE", "true");
      for (const surface of SURFACES) {
        const ids = availableCapabilities(surface).map((c) => c.id);
        for (const cloudOnly of ["ocr", "translate", "admin", "wb.translate"]) {
          expect(ids, `${cloudOnly} leaked into ${surface}`).not.toContain(cloudOnly);
        }
      }
    });

    it("offers Transcribe and Speak, which run on the offline engines", () => {
      vi.stubEnv("VITE_LOCAL_VOICE", "true");
      expect(isCapabilityAvailable("transcribe")).toBe(true);
      expect(isCapabilityAvailable("speak")).toBe(true);
      expect(availableCapabilities("workspace-menu").map((c) => c.id)).toContain("transcribe");
    });

    it("withdraws them again when the local voice flag is off", () => {
      vi.stubEnv("VITE_LOCAL_VOICE", "false");
      expect(isCapabilityAvailable("transcribe")).toBe(false);
      expect(isCapabilityAvailable("speak")).toBe(false);
      // Nothing is left to put under a "Tools" heading, so the group goes too.
      expect(availableCapabilities("workspace-menu").filter((c) => c.group === "tool")).toEqual([]);
    });

    it("drops the cloud halves of the voice tools", () => {
      expect(isCapabilityAvailable("voice.cloning")).toBe(false);
      expect(isCapabilityAvailable("tokens.meter")).toBe(false);
      expect(capabilityUnavailableReason("voice.cloning")).toMatch(/ElevenLabs/);
    });

    it("still offers the workspace and the local workbench tabs", () => {
      vi.stubEnv("VITE_AGENT_MODE", "false");
      expect(isCapabilityAvailable("workspace")).toBe(true);
      const tabs = availableCapabilities("workbench-tab").map((c) => c.id);
      expect(tabs).toEqual(["wb.aiReader", "wb.research", "wb.notes"]);
    });

    it("adds the Agent tab on desktop once VITE_AGENT_MODE is on", () => {
      vi.stubEnv("VITE_AGENT_MODE", "true");
      const tabs = availableCapabilities("workbench-tab").map((c) => c.id);
      expect(tabs).toContain("wb.agent");
    });
  });

  /**
   * The assertion that makes the original bug unrepeatable. WorkspaceAppMenu and
   * Dashboard each held their own hardcoded list of tool routes and drifted out
   * of sync with AppLayout's; nothing failed when they did. Now a component that
   * writes one of those paths as a literal fails here instead.
   */
  it("lets no component navigate to a platform-gated route it hardcoded", () => {
    const gated = new Set(
      CAPABILITIES.filter((c) => c.route && Object.values(c.runtimes).some((a) => a.on !== "always"))
        .map((c) => c.route!),
    );
    const violations: string[] = [];

    // Only NAVIGATION positions count: `navigate("/ocr")`, `<Link to="/ocr">`,
    // `href="/ocr"`. A page naming its own route for SEO, or a section->route
    // lookup keyed by data the runtime never produces, sends nobody anywhere.
    const isNavigationTarget = (node: ts.StringLiteral, sf: ts.SourceFile): boolean => {
      const parent = node.parent;
      if (ts.isJsxAttribute(parent) === false && ts.isCallExpression(parent)) {
        const callee = parent.expression;
        const name = ts.isIdentifier(callee) ? callee.text
          : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
        return (name === "navigate" || name === "replace") && parent.arguments[0] === node;
      }
      const attribute = ts.isJsxExpression(parent) ? parent.parent : parent;
      return (
        ts.isJsxAttribute(attribute) &&
        ["to", "href"].includes(attribute.name.getText(sf))
      );
    };

    for (const file of sourceFiles()) {
      const relative = relativeSourcePath(file);
      if (!relative.startsWith("src/components/") && !relative.startsWith("src/pages/")) continue;
      // App.tsx declares the routes; CapabilityRoute is what redirects away from
      // them; the marketing guide is web-only and never renders on desktop.
      if (/App\.tsx$|CapabilityRoute\.tsx$|pages\/guides\//.test(relative)) continue;
      // Links *inside* a web-only feature. OCR is `desktop: never`, so neither
      // of these pages can render on a runtime where their target is missing;
      // the gate they need is the one already on the page they live in.
      if (WEB_ONLY_FEATURE_PAGES.has(relative)) continue;

      const source = readSource(file);
      if (!/["'/](transcribe|speak|ocr|extract|translate|admin)["']/.test(source)) continue;

      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isStringLiteral(node) && gated.has(node.text) && isNavigationTarget(node, sourceFile)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          violations.push(`${relative}:${line}: "${node.text}"`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    expect(violations).toEqual([]);
  }, 30_000);
});
