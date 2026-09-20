import { describe, it, expect } from "vitest";
import easyEditorMcp from "../lib/mcp/index";
import calculateFaraidTool from "../lib/mcp/tools/calculate-faraid";
import searchIslamicCorpusTool from "../lib/mcp/tools/search-islamic-corpus";
import takhrijHadithTool from "../lib/mcp/tools/takhrij-hadith";

describe("Open Islamic Knowledge MCP Server (ADR 0055 Phase 3a)", () => {
  it("registers all 7 tools with version 0.2.0", () => {
    expect(easyEditorMcp.name).toBe("easy-editor-mcp");
    expect(easyEditorMcp.version).toBe("0.2.0");
    const toolNames = easyEditorMcp.tools.map((t: any) => t.name);
    expect(toolNames).toContain("whoami");
    expect(toolNames).toContain("list_recent_sessions");
    expect(toolNames).toContain("list_research_sessions");
    expect(toolNames).toContain("token_balance");
    expect(toolNames).toContain("search_islamic_corpus");
    expect(toolNames).toContain("takhrij_hadith");
    expect(toolNames).toContain("calculate_faraid");
    expect(easyEditorMcp.tools).toHaveLength(7);
  });
});

describe("calculate_faraid tool", () => {
  it("has correct tool metadata", () => {
    expect(calculateFaraidTool.name).toBe("calculate_faraid");
    expect(calculateFaraidTool.annotations?.readOnlyHint).toBe(true);
  });

  it("calculates deterministic inheritance shares for standard estate", async () => {
    const input = {
      heirs: {
        husband: 1,
        daughter: 1,
        mother: 1,
      },
      estateValue: 24000,
      currency: "PKR",
    };

    const ctx = {
      isAuthenticated: () => true,
    } as any;

    const res = await (calculateFaraidTool.handler as any)(input, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toBeDefined();

    const result = res.structuredContent;
    expect(result.asl).toBeGreaterThan(0);
    expect(result.lines).toHaveLength(3);

    // Verify heirs in lines
    const heirTypes = result.lines.map((l: any) => l.heir);
    expect(heirTypes).toContain("husband");
    expect(heirTypes).toContain("daughter");
    expect(heirTypes).toContain("mother");

    // Total amounts sum to estate value
    const totalDistributed = result.lines.reduce((acc: number, l: any) => acc + (l.amount ?? 0), 0);
    expect(totalDistributed).toBeCloseTo(24000, 1);
  });

  it("rejects empty or unrecognized heirs with error", async () => {
    const ctx = { isAuthenticated: () => true } as any;
    const res = await (calculateFaraidTool.handler as any)({ heirs: { alien: 5 } }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("No valid surviving heirs");
  });
});

describe("search_islamic_corpus tool", () => {
  it("has correct tool definition and annotations", () => {
    expect(searchIslamicCorpusTool.name).toBe("search_islamic_corpus");
    expect(searchIslamicCorpusTool.annotations?.readOnlyHint).toBe(true);
  });

  it("refuses unauthenticated callers", async () => {
    const ctx = { isAuthenticated: () => false } as any;
    const res = await (searchIslamicCorpusTool.handler as any)({ query: "تفسير" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Not authenticated");
  });
});

describe("takhrij_hadith tool", () => {
  it("has correct tool definition and annotations", () => {
    expect(takhrijHadithTool.name).toBe("takhrij_hadith");
    expect(takhrijHadithTool.annotations?.readOnlyHint).toBe(true);
  });

  it("refuses unauthenticated callers", async () => {
    const ctx = { isAuthenticated: () => false } as any;
    const res = await (takhrijHadithTool.handler as any)({ hadithText: "إنما الأعمال بالنيات" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Not authenticated");
  });
});
