import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ModeBadge from '../components/ModeBadge';

/**
 * SPEC-M5 FR-2.4 / risk R9: with a local workspace and a cloud one that never
 * sync, a user who cannot tell which they are in will look for a document in
 * the wrong home and think it was lost.
 */
const win = window as unknown as Record<string, unknown>;

describe('ModeBadge', () => {
  afterEach(() => {
    delete win.electronAPI;
    cleanup();
  });

  it('marks the workspace as local on desktop', () => {
    win.electronAPI = { isDesktop: true };
    render(<ModeBadge />);
    expect(screen.getByText('مقامی')).toBeInTheDocument();
  });

  it('says where the work actually lives', () => {
    win.electronAPI = { isDesktop: true };
    render(<ModeBadge />);
    expect(screen.getByTitle(/اسی کمپیوٹر پر محفوظ/)).toBeInTheDocument();
  });

  it('renders nothing on the web, where there is no second home', () => {
    const { container } = render(<ModeBadge />);
    expect(container).toBeEmptyDOMElement();
  });
});
