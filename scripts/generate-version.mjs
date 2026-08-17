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

// Hosted builds frequently have no usable git repo — the source arrives as an
// archive, or as a shallow clone with `.git` stripped, so `git rev-parse` fails
// and both fields silently became "unknown". That is not cosmetic: the commit
// hash is how a deploy is verified as actually live, and without it a stale
// bundle is indistinguishable from a fresh one. Every major host exposes the
// SHA as an environment variable, so fall back to those before giving up.
const env = process.env;

function fromGit(args) {
  try {
    return execSync(`git ${args}`, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

const envCommit =
  env.VERCEL_GIT_COMMIT_SHA ||     // Vercel
  env.CF_PAGES_COMMIT_SHA ||       // Cloudflare Pages
  env.COMMIT_REF ||                // Netlify
  env.GITHUB_SHA ||                // GitHub Actions
  env.CI_COMMIT_SHA ||             // GitLab CI
  env.SOURCE_VERSION ||            // Heroku
  null;

const envBranch =
  env.VERCEL_GIT_COMMIT_REF ||
  env.CF_PAGES_BRANCH ||
  env.BRANCH ||                    // Netlify
  env.GITHUB_REF_NAME ||
  env.CI_COMMIT_REF_NAME ||
  null;

const commit = (fromGit('rev-parse --short HEAD') || (envCommit ? envCommit.slice(0, 7) : null) || 'unknown');
const branch = (fromGit('rev-parse --abbrev-ref HEAD') || envBranch || 'unknown');

if (commit === 'unknown') {
  console.warn('[generate-version] No git repo and no CI commit env var — deploy verification by commit hash will not work.');
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
