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

export function scanChromeDirs(dirs?: string[]): UiDisciplineScanResult;
