import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

export interface SidecarStatus {
  installed: boolean;
  pythonPath: string | null;
  version?: string;
  modelsAvailable: string[];
  error?: string;
}

const GET_SIDECAR_DIR = () => {
  const base = app?.getPath ? app.getPath('userData') : process.cwd();
  return path.join(base, 'python_sidecar');
};

/**
 * Checks if the optional Python sidecar virtualenv exists.
 */
export async function checkSidecarStatus(): Promise<SidecarStatus> {
  const sidecarDir = GET_SIDECAR_DIR();
  const venvPython = process.platform === 'win32'
    ? path.join(sidecarDir, 'Scripts', 'python.exe')
    : path.join(sidecarDir, 'bin', 'python');

  if (!fs.existsSync(venvPython)) {
    return {
      installed: false,
      pythonPath: null,
      modelsAvailable: [],
    };
  }

  try {
    const version = await getPythonVersion(venvPython);
    return {
      installed: true,
      pythonPath: venvPython,
      version,
      modelsAvailable: ['orpheus-urdu', 'mms-tts', 'habibi', 'cohere-ar'],
    };
  } catch (err: any) {
    return {
      installed: false,
      pythonPath: venvPython,
      modelsAvailable: [],
      error: err.message,
    };
  }
}

function getPythonVersion(pythonPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonPath, ['--version'], { windowsHide: true });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Python exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

/**
 * Triggers virtual environment creation & pip dependencies installation for sidecar.
 */
export async function installSidecarEnv(): Promise<{ success: boolean; message: string }> {
  const sidecarDir = GET_SIDECAR_DIR();

  try {
    if (!fs.existsSync(sidecarDir)) {
      fs.mkdirSync(sidecarDir, { recursive: true });
    }

    const venvPython = process.platform === 'win32'
      ? path.join(sidecarDir, 'Scripts', 'python.exe')
      : path.join(sidecarDir, 'bin', 'python');

    // Step 1: create virtualenv if not already present
    if (!fs.existsSync(venvPython)) {
      await runProcess('python', ['-m', 'venv', sidecarDir]);
    }

    // Step 2: install dependencies
    // No edge-tts here: FR-6.6's online engine runs on the `msedge-tts` Node
    // package, so it stays available whether or not this sidecar is installed.
    const requirements = [
      'torch>=2.0.0',
      'transformers>=4.30.0',
      'accelerate>=0.20.0',
    ];

    for (const pkg of requirements) {
      await runProcess(venvPython, ['-m', 'pip', 'install', pkg]);
    }

    return {
      success: true,
      message: 'Sidecar environment created and dependencies installed.',
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Sidecar setup failed: ${err.message}`,
    };
  }
}

function runProcess(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true, stdio: 'pipe' });
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`"${cmd}" exited with code ${code}: ${stderr}`));
    });
    proc.on('error', reject);
  });
}
