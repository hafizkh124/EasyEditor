import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock sonner so toast.error is a spy, not a real DOM call
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { toast } from "sonner";
import { classifyError, handleSupabaseError, wrapSupabase } from "@/lib/errors";
import type { PostgrestError } from "@supabase/supabase-js";

// ── helpers ────────────────────────────────────────────────────────────────

function pgError(code: string, message = "db error"): PostgrestError {
  return { code, message, details: "", hint: "", name: "PostgrestError" };
}

function httpError(status: number, message = "http error") {
  return { status, message };
}

// ── classifyError ──────────────────────────────────────────────────────────

describe("classifyError", () => {
  it("maps PGRST116 (no rows) to a friendly message", () => {
    expect(classifyError(pgError("PGRST116"))).toBe("No matching record found.");
  });

  it("maps 42P01 (missing table) to setup message", () => {
    expect(classifyError(pgError("42P01"))).toBe(
      "Service setup in progress — try again in a moment."
    );
  });

  it("maps 23505 (unique violation) correctly", () => {
    expect(classifyError(pgError("23505"))).toBe("This record already exists.");
  });

  it("maps HTTP 401 to session-expired message", () => {
    expect(classifyError(httpError(401))).toBe("Session expired — please sign in again.");
  });

  it("maps HTTP 403 to permission message", () => {
    expect(classifyError(httpError(403))).toBe("You don't have permission to do that.");
  });

  it("maps HTTP 429 to usage-limit message", () => {
    expect(classifyError(httpError(429))).toBe(
      "You've hit the usage limit — please wait a moment."
    );
  });

  it("maps HTTP 500 to server-error message", () => {
    expect(classifyError(httpError(500))).toBe("Server error — please try again.");
  });

  it("maps 'Failed to fetch' to connection-lost message", () => {
    expect(classifyError(new Error("Failed to fetch"))).toBe(
      "Connection lost — check your internet connection."
    );
  });

  it("maps 'NetworkError' message to connection-lost", () => {
    expect(classifyError({ message: "NetworkError when attempting to fetch resource" })).toBe(
      "Connection lost — check your internet connection."
    );
  });

  it("maps JSON parse errors to unexpected-response message", () => {
    expect(classifyError(new Error("JSON parse error"))).toBe(
      "Unexpected response from server."
    );
  });

  it("maps JWT expired to session-expired message", () => {
    expect(classifyError({ message: "JWT expired" })).toBe(
      "Session expired — please sign in again."
    );
  });

  it("maps timeout errors correctly", () => {
    expect(classifyError(new Error("Request timed out"))).toBe(
      "Request timed out — please try again."
    );
  });

  it("falls back to generic message for unknown errors", () => {
    expect(classifyError(pgError("99999"))).toBe("Something went wrong — please try again.");
  });

  it("handles null/undefined gracefully", () => {
    expect(classifyError(null)).toBe("An unexpected error occurred.");
    expect(classifyError(undefined)).toBe("An unexpected error occurred.");
  });
});

// ── handleSupabaseError ────────────────────────────────────────────────────

describe("handleSupabaseError", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fires toast.error with the friendly message", () => {
    handleSupabaseError(pgError("PGRST116"), "test");
    expect(toast.error).toHaveBeenCalledWith("No matching record found.");
  });

  it("returns the friendly message", () => {
    const msg = handleSupabaseError(httpError(401));
    expect(msg).toBe("Session expired — please sign in again.");
  });

  it("logs to console.error with context prefix", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    handleSupabaseError(pgError("23505"), "save profile");
    expect(spy.mock.calls[0][0]).toContain("[save profile]");
    spy.mockRestore();
  });

  it("logs to console.error with default prefix when no context given", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    handleSupabaseError(pgError("23505"));
    expect(spy.mock.calls[0][0]).toContain("[supabase]");
    spy.mockRestore();
  });
});

// ── wrapSupabase ───────────────────────────────────────────────────────────

describe("wrapSupabase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns data when there is no error", () => {
    const result = wrapSupabase({ data: { id: 1 }, error: null });
    expect(result).toEqual({ id: 1 });
  });

  it("returns null and fires toast when error is present", () => {
    const result = wrapSupabase({ data: null, error: pgError("PGRST116") }, "load profile");
    expect(result).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("No matching record found.");
  });

  it("returns null silently when both data and error are null", () => {
    const result = wrapSupabase({ data: null, error: null });
    expect(result).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
