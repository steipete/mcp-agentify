import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const requiredFiles = ['dist/cli.js', 'dist/server.js', 'dist/frontend/index.html', 'bin/mcp-agentify.cjs'];

for (const relativePath of requiredFiles) {
    if (!existsSync(resolve(relativePath))) {
        throw new Error(`Missing package artifact: ${relativePath}`);
    }
}

if (existsSync(resolve('dist/src/cli.js'))) {
    throw new Error('Unexpected stale artifact: dist/src/cli.js');
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (packageJson.name !== '@steipete/mcp-agentify') {
    throw new Error(`Unexpected package name: ${packageJson.name}`);
}
if (packageJson.bin?.['mcp-agentify'] !== './bin/mcp-agentify.cjs') {
    throw new Error('mcp-agentify binary is not configured correctly.');
}
