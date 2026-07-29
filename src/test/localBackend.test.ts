import { describe, it, expect, beforeEach } from 'vitest';
import { localBackend } from '../core/backend/localBackend';
import { isDesktop, getBackend } from '../core/backend/index';

describe('localBackend Seam & Interface Contract', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).electronAPI;
  });

  it('has kind discriminant equal to "local"', () => {
    expect(localBackend.kind).toBe('local');
  });

  it('routes getBackend to localBackend when in desktop mode', () => {
    (window as unknown as Record<string, unknown>).electronAPI = { isDesktop: true };
    expect(isDesktop()).toBe(true);
    expect(getBackend().kind).toBe('local');
  });

  it('routes getBackend to cloudBackend when in web mode', () => {
    expect(isDesktop()).toBe(false);
    expect(getBackend().kind).toBe('cloud');
  });
});
