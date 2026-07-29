import { describe, it, expect } from 'vitest';
import { isAllowedIpcChannel, ALLOWED_IPC_CHANNELS } from '../../electron/ipc/registry';

describe('Shamela Native Integration & Registry', () => {
  it('includes SHAMELA_INVOKE in ALLOWED_IPC_CHANNELS', () => {
    expect(ALLOWED_IPC_CHANNELS.SHAMELA_INVOKE).toBe('shamela:invoke');
    expect(isAllowedIpcChannel('shamela:invoke')).toBe(true);
  });

  it('rejects unregistered shamela IPC channels', () => {
    expect(isAllowedIpcChannel('shamela:unregistered_action')).toBe(false);
  });
});
