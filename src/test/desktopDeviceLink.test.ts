import { describe, it, expect, vi } from "vitest";

// The live bug this guards against: `verifyOtp({ email, token_hash, type })`
// — passing BOTH `email` and `token_hash` — is rejected outright by auth-js
// ("Only the token_hash and type should be provided"), which a real desktop
// sign-in hit on first live use. `token_hash` and `email` are two mutually
// exclusive verify modes, not a pair.
const { verifyOtp } = vi.hoisted(() => ({ verifyOtp: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { verifyOtp } },
}));

import { completeDeviceLinkSignIn } from "@/lib/desktopDeviceLink";

describe("completeDeviceLinkSignIn", () => {
  it("calls verifyOtp with ONLY token_hash + type — never email alongside it", async () => {
    await completeDeviceLinkSignIn("scholar@example.com", "test-hashed-token");
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "test-hashed-token", type: "magiclink" });
    const call = verifyOtp.mock.calls[0][0];
    expect(call).not.toHaveProperty("email");
  });

  it("surfaces a verifyOtp error rather than swallowing it", async () => {
    verifyOtp.mockResolvedValueOnce({ error: { message: "boom" } });
    const { error } = await completeDeviceLinkSignIn("scholar@example.com", "bad-token");
    expect(error?.message).toBe("boom");
  });
});
