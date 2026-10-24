import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const [f, dest] of [['redact.js', 'extension/lib'], ['mask.js', 'extension/lib'], ['redact.js', 'server/src']]) {
  copyFileSync(join(root, 'shared', f), join(root, dest, f));
  console.log('synced', f, '->', dest);
}
