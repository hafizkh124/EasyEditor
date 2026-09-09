/**
 * JKHSSN (جامع خادم الحرمين الشريفين / جوامع الكلم) engine — shared constants.
 *
 * Pure: no `fs`, no `electron`, no runtime globals. Imported by the Electron
 * main process (detection, index build) and the renderer (availability hook).
 */

/**
 * Bumped whenever `electron/jkhssn/schema.sql` or the extraction in
 * `buildIndex.ts` changes in a way that makes an existing `jkhssn.sqlite`
 * wrong. `detectJkhssnInstallation()` marks an index `stale` when
 * `meta.schema_version` disagrees, and the build guard checks the shipped seed.
 */
export const JKHSSN_INDEX_SCHEMA_VERSION = 1;

/** Filename of the built index under `app.getPath('userData')`. */
export const JKHSSN_INDEX_FILE = 'jkhssn.sqlite';

/** Filename of the saved data-path override under `userData`. */
export const JKHSSN_CONFIG_FILE = 'jkhssn_config.json';

/**
 * Well-known install roots probed before falling back to the saved override.
 * The discovery key inside each is `Data/HadithDB/Catalog.xml` (ADR-0007: a
 * readable key file, never a registry uninstall entry).
 */
export const JKHSSN_CANDIDATE_ROOTS: readonly string[] = [
  'D:\\JKHSSN',
  'E:\\JKHSSN',
  'C:\\JKHSSN',
  'C:\\Program Files\\JKHSSN',
  'C:\\Program Files (x86)\\JKHSSN',
  'D:\\جوامع الكلم',
  'C:\\جوامع الكلم',
];

/** Relative path from an install root to the hadith column-store. */
export const JKHSSN_HADITHDB_SUBPATH = 'Data\\HadithDB';

/** The file whose presence proves a readable HadithDB. */
export const JKHSSN_DISCOVERY_KEY = 'Catalog.xml';

/** `#`-scope / provenance id for the connector and the search-history kind. */
export const JKHSSN_CONNECTOR_ID = 'jkhssn';
