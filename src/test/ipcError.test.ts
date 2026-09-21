import { describe, it, expect } from "vitest";
import { cleanIpcError } from "@/lib/ipcError";

describe("cleanIpcError", () => {
  it("removes Electron's wrapper and the original error's class prefix", () => {
    expect(cleanIpcError(new Error("Error invoking remote method 'ai:invoke': Error: [Could not read file]")))
      .toBe("[Could not read file]");
    expect(cleanIpcError(new Error("Error invoking remote method 'ai:invoke': ByokApiError: کوئی Gemini key پاس نہیں کی گئی — Settings میں اپنی کلید درج کریں")))
      .toBe("کوئی Gemini key پاس نہیں کی گئی — Settings میں اپنی کلید درج کریں");
  });

  it("leaves an ordinary message alone", () => {
    expect(cleanIpcError(new Error("File is too large"))).toBe("File is too large");
    expect(cleanIpcError("plain string")).toBe("plain string");
  });

  it("strips only a LEADING class prefix, never text inside the message", () => {
    expect(cleanIpcError(new Error("could not parse TypeError: x"))).toBe("could not parse TypeError: x");
  });

  it("falls back to the raw message rather than returning an empty one", () => {
    // a message that is nothing but a prefix: better to show it than to show nothing
    expect(cleanIpcError(new Error("Error: "))).not.toBe("");
    expect(cleanIpcError(undefined)).toBe("");
  });
});
