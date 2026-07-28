import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const outputPath = path.join(rootDir, 'public', 'app-version.json');

let version = '2.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  version = pkg.version || version;
} catch (err) {
  console.warn('[generate-version] Could not read package.json version:', err.message);
}

let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
} catch (err) {
  console.warn('[generate-version] Could not get git commit hash:', err.message);
}

let branch = 'unknown';
try {
  branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
} catch (err) {
  console.warn('[generate-version] Could not get git branch:', err.message);
}

const versionInfo = {
  version,
  commit,
  branch,
  builtAt: new Date().toISOString()
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(versionInfo, null, 2), 'utf8');

console.log(`[generate-version] Successfully generated public/app-version.json: v${version} (${commit} on ${branch})`);
