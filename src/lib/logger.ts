/**
 * Lightweight logger with per-request correlation IDs.
 *
 * Usage:
 *   const log = logger.child("Research");
 *   const reqId = log.requestId();
 *   log.info("sending query", { reqId });
 *   // ...later
 *   log.error("stream failed", { reqId, err });
 *
 * In production we only surface warn/error; info/debug are dev-only.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const isDev = import.meta.env.DEV;

function generateRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

function emit(level: LogLevel, scope: string, msg: string, extra?: Record<string, unknown>) {
  if (!isDev && (level === "debug" || level === "info")) return;
  const prefix = `[${scope}]`;
  const payload = extra ? [prefix, msg, extra] : [prefix, msg];
  (console[level === "debug" ? "log" : level] as (...args: unknown[]) => void)(...payload);
}

export type Logger = {
  requestId: () => string;
  debug: (msg: string, extra?: Record<string, unknown>) => void;
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, extra?: Record<string, unknown>) => void;
  child: (childScope: string) => Logger;
};

function make(scope: string): Logger {
  return {
    requestId: generateRequestId,
    debug: (msg, extra) => emit("debug", scope, msg, extra),
    info: (msg, extra) => emit("info", scope, msg, extra),
    warn: (msg, extra) => emit("warn", scope, msg, extra),
    error: (msg, extra) => emit("error", scope, msg, extra),
    child: (childScope) => make(`${scope}/${childScope}`),
  };
}

export const logger = make("App");
