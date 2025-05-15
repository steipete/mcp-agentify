import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Import getLogger for the fallback logging within getPackageVersion
// This creates a slight circular dependency risk if logger.ts also imports from utils.ts
// For a simple utility like this, it might be okay, or remove the logger call inside.
// Alternatively, pass a logger instance to getPackageVersion if needed.
// For now, let's keep it simple and see if tree-shaking/bundlers handle it.
import { getLogger } from './logger'; 

export function getPackageVersion(): string {
    try {
        const packageJsonPath = resolve(process.cwd(), 'package.json');
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        return packageJson.version || '0.1.0'; // Default if version field is missing
    } catch (error) {
        // Use a simple console.warn if getLogger creates issues here, 
        // or ensure this util is only called after logger is surely initialized.
        // const logger = getLogger(); // This might be problematic if logger itself is not yet up.
        // logger.warn({ err: error }, 'Could not read package.json version, defaulting to 0.1.0');
        console.warn(`[mcp-agentify/utils] Could not read package.json version, defaulting to 0.1.0. Error: ${(error as Error).message}`);
        return '0.1.0';
    }
} 