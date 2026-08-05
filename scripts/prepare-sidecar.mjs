import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = join(root, 'src-tauri');
const release = process.argv.includes('--release');
const profile = release ? 'release' : 'debug';
const cargo = process.env.CARGO || 'cargo';
const rustc = process.env.RUSTC || 'rustc';

const version = execFileSync(rustc, ['-vV'], { encoding: 'utf8' });
const host = version.match(/^host:\s*(.+)$/m)?.[1]?.trim();
if (!host) {
  throw new Error('Unable to determine the Rust host target from `rustc -vV`');
}

const cargoArgs = [
  'build',
  '--manifest-path',
  join(tauriDir, 'Cargo.toml'),
  '--locked',
  '--bin',
  'cc-status-emit',
];
if (release) cargoArgs.push('--release');
execFileSync(cargo, cargoArgs, {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    // Building the helper is the bootstrap step that creates externalBin.
    // Disable sidecar validation for this one Cargo invocation to avoid a
    // circular dependency (Tauri otherwise requires the output to exist
    // before Cargo is allowed to build it).
    TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [] } }),
  },
});

const extension = process.platform === 'win32' ? '.exe' : '';
const source = join(tauriDir, 'target', profile, `cc-status-emit${extension}`);
const destination = join(
  tauriDir,
  'binaries',
  `cc-status-emit-${host}${extension}`,
);

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
if (process.platform !== 'win32') chmodSync(destination, 0o755);
console.log(`Prepared Tauri sidecar: ${destination}`);
