/**
 * M11 Phase 2 (ADR-0047) — the agent's live progress lines are localised.
 * `shared/agent/loop.ts` emits an `agent.step.<tool>` key alongside the English
 * `label`; the renderer does `t(labelKey, label)`. This pins that every tool in
 * the CLOSED registry has a real translation in all three locales (not just the
 * English fallback), and that the retired `agent.mode_do` / `agent.hint_do`
 * keys are gone.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import en from "@/locales/en.json";
import ur from "@/locales/ur.json";
import ar from "@/locales/ar.json";
import { AGENT_TOOLS } from "~shared/agent/toolSchemas";
import { stepLabelKey } from "~shared/agent/loop";

const locales = { en, ur, ar } as Record<string, Record<string, string>>;

describe("agent step-label localisation", () => {
  it("has an agent.step.<tool> entry in every locale for every registry tool", () => {
    const missing: string[] = [];
    for (const tool of AGENT_TOOLS) {
      const key = stepLabelKey(tool.name);
      for (const [lang, dict] of Object.entries(locales)) {
        if (!(key in dict) || !dict[key].trim()) missing.push(`${lang}:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("localises the fixed step labels too (done / error / clarify / plan)", () => {
    const fixed = [
      "agent.step.done",
      "agent.step.error",
      "agent.step.needs_clarification",
      "agent.step.plan_pending",
      "agent.step.plan_not_approved",
      "agent.step.batch_cancelled",
      "agent.step.batch_done",
    ];
    for (const key of fixed) {
      for (const [lang, dict] of Object.entries(locales)) {
        expect(dict[key]?.trim(), `${lang}:${key}`).toBeTruthy();
      }
    }
  });

  it("drops the retired agent.mode_do / agent.hint_do keys from every locale", () => {
    for (const dict of Object.values(locales)) {
      expect("agent.mode_do" in dict).toBe(false);
      expect("agent.hint_do" in dict).toBe(false);
    }
  });

  it("the Urdu step label differs from the English one (a real translation, not a copy)", () => {
    expect(ur["agent.step.search_shamela"]).not.toBe(en["agent.step.search_shamela"]);
    expect(ar["agent.step.read_document"]).not.toBe(en["agent.step.read_document"]);
  });
});
