// @vitest-environment node
import { describe, it, expect } from "vitest";
import { settleWithGrace } from "../../supabase/functions/_shared/fanOutGrace";

const after = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

describe("settleWithGrace", () => {
  it("waits for every core branch, however long they take", async () => {
    const out = await settleWithGrace([after(120, "a"), after(10, "b")], [false, false], 10);
    expect(out.map((r) => r.status === "fulfilled" && r.value)).toEqual(["a", "b"]);
  });

  it("drops an optional branch that is still running after the grace", async () => {
    const t0 = Date.now();
    const out = await settleWithGrace([after(20, "core"), after(2000, "slow")], [false, true], 100);
    expect(Date.now() - t0).toBeLessThan(600);
    expect(out[0]).toEqual({ status: "fulfilled", value: "core" });
    expect(out[1].status).toBe("rejected");
  });

  it("keeps an optional branch that finishes inside the grace", async () => {
    const out = await settleWithGrace([after(10, "core"), after(60, "opt")], [false, true], 300);
    expect(out[1]).toEqual({ status: "fulfilled", value: "opt" });
  });

  it("reports a rejected branch without throwing and keeps input order", async () => {
    const out = await settleWithGrace([Promise.reject(new Error("x")), after(5, "ok")], [false, false], 50);
    expect(out[0].status).toBe("rejected");
    expect(out[1]).toEqual({ status: "fulfilled", value: "ok" });
  });

  it("does not wait at all when there are no optional branches", async () => {
    const t0 = Date.now();
    await settleWithGrace([after(5, 1)], [false], 5000);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
