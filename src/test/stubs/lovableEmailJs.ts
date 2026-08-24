// Stand-in for `npm:@lovable.dev/email-js`, imported by process-email-queue.
//
// Unlike the other Deno specifiers this one has no npm counterpart installed —
// the platform resolves it at deploy time, so it is not in package.json and
// cannot be. Without this stub the function's index.ts is the only one of the
// 29 that cannot be imported by a test at all.
//
// Sending must be inert here: the contract tests drive the handler with
// malformed and empty payloads, and a stub that actually reached out would turn
// a unit test into an outbound email.

export class EmailAPIError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "EmailAPIError";
    this.status = status;
  }
}

/** Calls recorded so a test can assert nothing was sent. */
export const sentEmails: unknown[] = [];

export function sendLovableEmail(...args: unknown[]): Promise<{ id: string }> {
  sentEmails.push(args);
  return Promise.resolve({ id: "stub-email-id" });
}
