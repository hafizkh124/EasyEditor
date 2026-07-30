import { describe, it, expect, beforeEach } from 'vitest';
import { redactKeyFromLog, ByokApiError } from '../../electron/ai/geminiClient';
import { isDesktopEnv } from '../core/ai/aiAdapter';

describe('BYOK Gemini Key Security & Error Parsing', () => {
  it('redacts raw API keys from log strings', () => {
    const rawKey = 'AIzaSy1234567890abcdefghijklmnopqrstuvwxyz';
    const logMessage = `Error calling API with key ${rawKey} on endpoint`;
    const redacted = redactKeyFromLog(logMessage, rawKey);
    expect(redacted).not.toContain(rawKey);
    expect(redacted).toContain('AIzaSy***REDACTED***');
  });

  it('correctly maps invalid key error to Urdu message', () => {
    const err = new ByokApiError('API_KEY_INVALID', 400, 'invalid_key');
    expect(err.message).toBe('API_KEY_INVALID');
    expect(err.failureKind).toBe('invalid_key');
  });
});

describe('AI Adapter seam', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).electronAPI;
  });

  it('detects desktop environment when window.electronAPI is present', () => {
    expect(isDesktopEnv()).toBe(false);
    (window as unknown as Record<string, unknown>).electronAPI = { isDesktop: true };
    expect(isDesktopEnv()).toBe(true);
  });
});
