// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Pre-publication Security Audit Scan', () => {
  it('verifies LICENSE, README, CONTRIBUTING, and THIRD-PARTY files exist', () => {
    const root = process.cwd();
    expect(fs.existsSync(path.join(root, 'LICENSE'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'CONTRIBUTING.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'THIRD-PARTY.md'))).toBe(true);
  });

  it('scans code files for accidental hardcoded API secrets', () => {
    const root = process.cwd();
    const targetDirs = ['src', 'electron', 'shared'];
    const secretPatterns = [
      /AIzaSy[A-Za-z0-9_-]{33}/, // Gemini API Key pattern
      /sk-[A-Za-z0-9]{48}/,       // OpenAI API Key pattern
    ];

    function scanDir(dirPath: string) {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'test') {
          scanDir(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          const content = fs.readFileSync(fullPath, 'utf8');
          for (const pattern of secretPatterns) {
            expect(pattern.test(content), `Found hardcoded secret in ${fullPath}`).toBe(false);
          }
        }
      }
    }

    for (const d of targetDirs) {
      const full = path.join(root, d);
      if (fs.existsSync(full)) scanDir(full);
    }
  });
});
