/**
 * Main-process logger.
 *
 * Deliberately NOT the renderer's `src/lib/logger.ts`: nothing under
 * `electron/` imports from `src/`, and that module keys its dev-gating off
 * `import.meta.env.DEV`, which describes the renderer build rather than how the
 * packaged app is being run. Here the equivalent signal is
 * `process.env.VITE_DEV_SERVER_URL`, which `main.ts` already uses to tell a dev
 * run from a packaged one.
 *
 * Main-process output goes to the terminal in dev and to the platform's process
 * log once packaged, so `warn`/`error` must always emit — they are the only
 * record of a failure a user can send us. `debug`/`info` are dev-only.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

function emit(level: LogLevel, scope: string, msg: string, extra?: Record<string, unknown>) {
  if (!isDev && (level === "debug" || level === "info")) return;
  const prefix = `[${scope}]`;
  const payload = extra ? [prefix, msg, extra] : [prefix, msg];
  // eslint-disable-next-line no-console -- this module IS the console boundary
  (console[level === "debug" ? "log" : level] as (...args: unknown[]) => void)(...payload);
}

export type Logger = {
  debug: (msg: string, extra?: Record<string, unknown>) => void;
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, extra?: Record<string, unknown>) => void;
  child: (childScope: string) => Logger;
};

function make(scope: string): Logger {
  return {
    debug: (msg, extra) => emit("debug", scope, msg, extra),
    info: (msg, extra) => emit("info", scope, msg, extra),
    warn: (msg, extra) => emit("warn", scope, msg, extra),
    error: (msg, extra) => emit("error", scope, msg, extra),
    child: (childScope) => make(`${scope}/${childScope}`),
  };
}

export const logger = make("Main");
