/**
 * M8 Layer 2 — the Microsoft PowerPoint adapter (SPEC-M8 §3 "Layer 2", P9).
 *
 * Same shape as electron/adapters/word.ts. PowerPoint has no headless
 * `Visible = $false` mode, so the host opens presentations WithWindow:msoFalse
 * instead (see wordBridge.ps1 `pptOpen`); everything else is the familiar
 * op sequence through the shared Layer 1 host, path-validated and serialised.
 */
import { logger } from '../lib/logger.js';
import { getWordHost, refreshOwnedPowerpoint, runExclusive, detectTools } from '../host/index.js';
import type { PptOpenReply, PptOutlineReply } from '../host/types.js';
import type {
  AdapterDescriptor,
  AdapterAvailability,
  DeckStructure,
} from '../../shared/adapters/types.js';
import { assertSafeOutputPath, assertReadableFile, type DocExt } from './paths.js';

const log = logger.child('adapters/powerpoint');

/** What PowerPoint's `Presentations.Open` can load as a source. */
const OPENABLE: DocExt[] = ['.pptx', '.ppt'];

export const powerpointDescriptor: AdapterDescriptor = {
  id: 'powerpoint',
  label: 'Microsoft PowerPoint',
  reads: [{ format: 'pptx', quality: 1 }],
  writes: [
    { format: 'pptx', quality: 1 },
    { format: 'pdf', quality: 0.9, lossy: 'Slides become static pages — animations, transitions, and speaker notes are lost.' },
  ],
  ops: ['exportPresentation', 'readOutline'],
  platforms: ['win32'],
};

/** Whether PowerPoint automation works on this machine right now. */
export function available(): AdapterAvailability {
  const t = detectTools();
  return t.powerpoint
    ? { available: true, version: t.powerpointVersion ?? null }
    : { available: false, version: null, reason: 'Microsoft PowerPoint is not available.' };
}

const EXT_FOR: Record<'pptx' | 'pdf', DocExt> = { pptx: '.pptx', pdf: '.pdf' };

/** `.pptx`/`.ppt` → pptx / pdf via PowerPoint's own SaveAs. */
export async function exportPresentation(
  sourcePath: string,
  to: 'pptx' | 'pdf',
  outputPath: string,
): Promise<{ outputPath: string; ms: number }> {
  const src = assertReadableFile(sourcePath, OPENABLE);
  const out = assertSafeOutputPath(outputPath, [EXT_FOR[to]]);
  const started = Date.now();
  await runExclusive(async () => {
    const h = getWordHost();
    await h.sendOk({ op: 'pptOpen', path: src });
    await refreshOwnedPowerpoint();
    await h.sendOk({ op: 'pptExport', path: out, format: to });
    await h.sendOk({ op: 'pptClose' });
  });
  log.debug('exportPresentation', { to, out });
  return { outputPath: out, ms: Date.now() - started };
}

/** Read the deck outline — the `.pptx` → EasyEditor inspection side. */
export async function readOutline(sourcePath: string): Promise<DeckStructure> {
  const src = assertReadableFile(sourcePath, OPENABLE);
  return runExclusive(async () => {
    const h = getWordHost();
    const open = await h.sendOk<PptOpenReply>({ op: 'pptOpen', path: src });
    await refreshOwnedPowerpoint();
    try {
      const r = await h.sendOk<PptOutlineReply>({ op: 'pptReadOutline' });
      return {
        slideCount: r.slideCount ?? open.slideCount ?? 0,
        slides: (r.slides ?? []).map((s) => ({
          index: s.index,
          title: s.title ?? '',
          bullets: s.bullets ?? [],
        })),
      };
    } finally {
      await h.send({ op: 'pptClose' });
    }
  });
}
