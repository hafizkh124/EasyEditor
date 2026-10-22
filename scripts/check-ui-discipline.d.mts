export interface UiDisciplineViolation {
  file: string;
  line: number;
  label: string;
  text: string;
}

export interface UiDisciplineScanResult {
  hard: UiDisciplineViolation[];
  soft: UiDisciplineViolation[];
}

export const CHROME_DIRS: string[];
export const APP_WIDE_DIRS: string[];
export const STATUS_COLOR_DIRS: string[];

export function scanChromeDirs(
  chromeDirs?: string[],
  appWideDirs?: string[],
  statusColorDirs?: string[],
): UiDisciplineScanResult;
