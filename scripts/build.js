// One source (extension/), one build per browser family: only the manifest differs.
// Usage: node scripts/build.js [chrome|firefox|safari]
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const src = path.join(root, 'extension');
const dist = path.join(root, 'dist');

const targets = {
  chrome: (m) => m, // also Edge, Opera, Brave, Vivaldi, Arc
  firefox: (m) => {
    const { service_worker, ...bg } = m.background;
    return {
      ...m,
      background: { ...bg, scripts: [service_worker] }, // Firefox has no MV3 service worker
      browser_specific_settings: {
        gecko: {
          id: 'tabblock@lynch-cai.github.io',
          strict_min_version: '140.0', // data_collection_permissions; also covers storage.session (115) and module background (112)
          data_collection_permissions: { required: ['none'] },
        },
      },
    };
  },
  safari: (m) => ({ ...m, browser_specific_settings: { safari: { strict_min_version: '16.4' } } }), // storage.session + module SW
};
const zipped = ['chrome', 'firefox']; // Safari ships through Xcode, not a zip

const manifest = JSON.parse(await fs.readFile(path.join(src, 'manifest.json'), 'utf8'));
const wanted = process.argv[2] ? [process.argv[2]] : Object.keys(targets);

for (const target of wanted) {
  if (!targets[target]) throw new Error(`Unknown target "${target}" (${Object.keys(targets).join(', ')})`);
  const out = path.join(dist, target);
  await fs.rm(out, { recursive: true, force: true });
  await fs.cp(src, out, { recursive: true });
  await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(targets[target](manifest), null, 2) + '\n');
  if (zipped.includes(target)) {
    const zip = path.join(dist, `tabblock-${target}-${manifest.version}.zip`);
    await fs.rm(zip, { force: true });
    execFileSync('zip', ['-qr', zip, '.'], { cwd: out }); // cwd = target dir so manifest.json sits at the zip root
  }
  console.log(`built dist/${target}`);
}
