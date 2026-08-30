/**
 * M8 Layer 2 — the adapter registry (SPEC-M8 §3 "Layer 2", ADR-0017).
 *
 * One place that knows every tool adapter. The conversion planner (Layer 3)
 * takes this list and does a path search over each adapter's read/write edges;
 * adding a tool is one entry here, nothing else in the system changes.
 */
import { wordDescriptor, available as wordAvailable } from './word.js';
import { excelDescriptor, available as excelAvailable } from './excel.js';
import { powerpointDescriptor, available as powerpointAvailable } from './powerpoint.js';
import type { AdapterDescriptor, AdapterAvailability } from '../../shared/adapters/types.js';

interface RegisteredAdapter {
  descriptor: AdapterDescriptor;
  available: () => AdapterAvailability;
}

export const ADAPTERS: RegisteredAdapter[] = [
  { descriptor: wordDescriptor, available: wordAvailable },
  { descriptor: excelDescriptor, available: excelAvailable },
  { descriptor: powerpointDescriptor, available: powerpointAvailable },
];

/** Every adapter's descriptor — what the planner needs. */
export const ALL_ADAPTERS: AdapterDescriptor[] = ADAPTERS.map((a) => a.descriptor);

/** Descriptors for only the adapters whose tool is present on this machine. */
export function availableAdapters(): AdapterDescriptor[] {
  return ADAPTERS.filter((a) => a.available().available).map((a) => a.descriptor);
}
