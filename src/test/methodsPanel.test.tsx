import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

/**
 * M11 Phase 3 / M12 Phase H — MethodsPanel (the real page that replaced the
 * "Full methods page coming in a future update." placeholder).
 *
 * The whole point of deriving this page from the live registries instead of
 * hand-typing a description of what the agent does is that drift becomes
 * IMPOSSIBLE to miss — so this test does not spot-check a few strings, it
 * asserts every single connector, every non-connector-owned tool, and every
 * print-layout-loss line the registries currently hold is actually present
 * in the rendered output. Add a connector/tool/loss line to its registry and
 * this test would fail the moment the page stopped mentioning it — that is
 * the guarantee, not a nice-to-have.
 */
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

import { MethodsPanel } from "@/components/settings/MethodsPanel";
import { CONNECTORS, CONNECTOR_PROVENANCE_LABEL, connectorForTool } from "~shared/agent/connectors";
import { AGENT_TOOLS } from "~shared/agent/toolSchemas";
import { PRINT_LAYOUT_LOSS } from "~shared/print/trimSizes";

describe("MethodsPanel — derived from the live registries, never a hand-typed copy", () => {
  it("every connector's label and provenance chip appears", () => {
    const { container } = render(<MethodsPanel />);
    const text = container.textContent ?? "";
    for (const c of CONNECTORS) {
      expect(text, `connector ${c.id}`).toContain(c.label);
      expect(text, `provenance for ${c.id}`).toContain(CONNECTOR_PROVENANCE_LABEL[c.id] ?? c.id);
    }
  });

  it("every agent tool name appears somewhere on the page (owned by a connector, or under the general list)", () => {
    const { container } = render(<MethodsPanel />);
    const text = container.textContent ?? "";
    for (const tool of AGENT_TOOLS) {
      expect(text, `tool ${tool.name}`).toContain(tool.name);
    }
  });

  it("a tool with no connector shows up in the general list, not silently dropped", () => {
    const generalTool = AGENT_TOOLS.find((t) => connectorForTool(t.name) === null);
    expect(generalTool).toBeDefined();
    const { container } = render(<MethodsPanel />);
    expect(container.textContent ?? "").toContain(generalTool!.name);
  });

  it("every PRINT_LAYOUT_LOSS line is rendered verbatim", () => {
    const { container } = render(<MethodsPanel />);
    const text = container.textContent ?? "";
    for (const line of PRINT_LAYOUT_LOSS) {
      expect(text).toContain(line);
    }
  });
});
