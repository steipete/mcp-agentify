import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function getPackageVersion(): string {
    const packageJsonPath = resolve(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string };
    return packageJson.version || '0.0.0';
}
