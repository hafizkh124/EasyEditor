// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { checkSidecarStatus } from '../../electron/voice/pythonSidecar';

describe('Python Sidecar & Ethical Voice Cloning Tests', () => {
  it('checkSidecarStatus returns object with installed state', async () => {
    const status = await checkSidecarStatus();
    expect(status).toHaveProperty('installed');
    expect(status).toHaveProperty('modelsAvailable');
    expect(Array.isArray(status.modelsAvailable)).toBe(true);
  });
});
