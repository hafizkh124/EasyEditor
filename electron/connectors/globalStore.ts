/**
 * Connectors Hub — the GLOBAL connector switch layer.
 *
 * "Is this connector available on this machine?" — edited from Settings →
 * Connectors, stored in `userData/connectors.json`. Sits UNDER the per-project
 * map (`.easyeditor/project.json`, `electron/fs/projectFolder.ts`); the agent
 * sees a connector only when `mergeConnectorState(global, project)` says on.
 *
 * Derived, disposable state — deleting the file just resets every connector to
 * its `defaultOff`. Same userData-JSON shape as `electron/agent/journal.ts`.
 */
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { logger } from '../lib/logger.js';
import { CONNECTORS } from '../../shared/agent/connectors.js';

const log = logger.child('connectors/globalStore');
const FILE = 'connectors.json';

interface GlobalConnectorFile {
  enabled: Record<string, boolean>;
}

function storePath(): string {
  return path.join(app.getPath('userData'), FILE);
}

/** The global enable map (absent id = follow the connector's `defaultOff`). */
export function readGlobalConnectors(): Record<string, boolean> {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8')) as Partial<GlobalConnectorFile>;
    const src = raw?.enabled;
    if (!src || typeof src !== 'object') return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(src)) if (typeof v === 'boolean') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/**
 * Flip one connector on/off globally and persist. A `defaultOff` connector
 * keeps an explicit `true`; all others drop the key when turned on (absent =
 * follows the default). Unknown ids are rejected — the registry is curated.
 */
export function setGlobalConnector(id: string, on: boolean): Record<string, boolean> {
  const known = CONNECTORS.find((c) => c.id === id);
  if (!known) {
    log.warn('ignored unknown connector id', { id });
    return readGlobalConnectors();
  }
  const enabled = readGlobalConnectors();
  const defaultOff = known.defaultOff === true;
  if (on) {
    if (defaultOff) enabled[id] = true;
    else delete enabled[id];
  } else {
    if (defaultOff) delete enabled[id];
    else enabled[id] = false;
  }
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), `${JSON.stringify({ enabled }, null, 2)}\n`, 'utf8');
  } catch (err) {
    log.warn('could not write connectors.json', { message: (err as Error).message });
  }
  return enabled;
}
