import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * M9 Phase C (ADR-0031) — the multi-provider BYOK panel. What must hold: it
 * lists every provider, shows the verified gate on non-Gemini ones, surfaces
 * the refusal when activating an unverified provider, and routes save/test to
 * the right provider id.
 */
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) } }));

const byok = {
  listProviders: vi.fn(async () => ([
    { id: 'gemini', label: 'Google Gemini', kind: 'gemini', freeTier: true, getKeyUrl: 'https://aistudio.google.com/apikey', keyEnvVar: 'GEMINI_API_KEY', toolModel: 'gemini-2.5-flash', textModel: 'gemini-2.5-flash', privacyNote: null, keyPattern: 'AIzaSy[A-Za-z0-9_-]{20,}' },
    { id: 'groq', label: 'Groq', kind: 'openai-compat', freeTier: true, getKeyUrl: 'https://console.groq.com/keys', keyEnvVar: 'GROQ_API_KEY', toolModel: 'llama-3.3-70b-versatile', textModel: 'llama-3.3-70b-versatile', privacyNote: null, keyPattern: 'gsk_[A-Za-z0-9]{20,}' },
    { id: 'openrouter', label: 'OpenRouter', kind: 'openai-compat', freeTier: false, getKeyUrl: 'https://openrouter.ai/keys', keyEnvVar: 'OPENROUTER_API_KEY', toolModel: 'x', textModel: 'x', privacyNote: 'routes outside the EU/US', keyPattern: 'sk-or-v1-[A-Za-z0-9]{20,}' },
  ])),
  providerState: vi.fn(async () => ({ active: 'gemini', verified: ['gemini'] })),
  getKeyStatus: vi.fn(async () => ({ hasKey: false, lastFour: null })),
  saveKey: vi.fn(async () => true),
  testKey: vi.fn(async () => ({ success: true, message: 'ok' })),
  deleteKey: vi.fn(async () => true),
  setActiveProvider: vi.fn(async () => ({ active: 'gemini' })),
  markProviderVerified: vi.fn(async () => ({ active: 'gemini', verified: ['gemini', 'groq'] })),
};

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = { isDesktop: true, byok, openExternal: vi.fn(async () => true) };
  Object.assign(navigator, { clipboard: { readText: vi.fn(async () => '') } });
});
afterEach(() => { delete (window as unknown as { electronAPI?: unknown }).electronAPI; });

async function renderPanel() {
  const { ByokKeyPanel } = await import('../components/settings/ByokKeyPanel');
  render(<ByokKeyPanel />);
  await waitFor(() => expect(screen.getByText('Groq')).toBeInTheDocument());
}

describe('ByokKeyPanel (multi-provider)', () => {
  it('lists every provider with the privacy note on OpenRouter', async () => {
    await renderPanel();
    expect(screen.getByText('Google Gemini')).toBeInTheDocument();
    expect(screen.getByText('OpenRouter')).toBeInTheDocument();
    expect(screen.getByText(/routes outside the EU\/US/)).toBeInTheDocument();
  });

  it('shows non-Gemini providers as unverified with the eval command', async () => {
    await renderPanel();
    expect(screen.getAllByText('غیر تصدیق شدہ').length).toBe(2);
    expect(screen.getByText(/EVAL_PROVIDER=groq AGENT_EVAL_LIVE=1/)).toBeInTheDocument();
  });

  it('surfaces the refusal when activating an unverified provider', async () => {
    byok.setActiveProvider.mockRejectedValueOnce(new Error('Groq has not passed the agent eval on this machine yet'));
    await renderPanel();
    fireEvent.click(screen.getByLabelText('Groq کو فعال کریں'));
    await waitFor(() => expect(screen.getByText(/has not passed the agent eval/)).toBeInTheDocument());
  });

  it('tests then saves a key against the right provider id', async () => {
    await renderPanel();
    const groqInput = screen.getByPlaceholderText('gsk_…');
    fireEvent.change(groqInput, { target: { value: 'gsk_abcdefghijklmnopqrst' } });
    fireEvent.click(screen.getAllByText('محفوظ و تصدیق')[1]);
    await waitFor(() => expect(byok.testKey).toHaveBeenCalledWith('gsk_abcdefghijklmnopqrst', 'groq'));
    await waitFor(() => expect(byok.saveKey).toHaveBeenCalledWith('gsk_abcdefghijklmnopqrst', 'groq'));
  });

  it('marks a provider verified', async () => {
    await renderPanel();
    const checkbox = screen.getAllByRole('checkbox')[0];
    fireEvent.click(checkbox);
    await waitFor(() => expect(byok.markProviderVerified).toHaveBeenCalledWith('groq', true));
  });

  it('prefills a key spotted on the clipboard', async () => {
    (navigator.clipboard.readText as ReturnType<typeof vi.fn>).mockResolvedValue('gsk_liveKeyFromClipboard123');
    await renderPanel();
    await waitFor(() => expect((screen.getByPlaceholderText('gsk_…') as HTMLInputElement).value).toBe('gsk_liveKeyFromClipboard123'));
    expect(screen.getByText(/کلپ بورڈ سے Groq/)).toBeInTheDocument();
  });
});
