import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const dist = resolve(root, 'dist');

if (dirname(dist) !== root) {
    throw new Error(`Refusing to clean unexpected path: ${dist}`);
}

rmSync(dist, { recursive: true, force: true });
