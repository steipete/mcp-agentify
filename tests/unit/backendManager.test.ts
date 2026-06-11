import { resolve } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { BackendManager } from '../../src/backendManager';
import { initializeLogger } from '../../src/logger';
import { BackendConfigSchema } from '../../src/schemas';

describe('BackendManager', () => {
    const managers: BackendManager[] = [];

    afterEach(async () => {
        await Promise.all(managers.map((manager) => manager.shutdownAllBackends()));
        managers.length = 0;
    });

    it('connects to a real MCP stdio backend, discovers tools, and calls one', async () => {
        const manager = new BackendManager(initializeLogger({ logLevel: 'silent' }));
        managers.push(manager);
        const config = BackendConfigSchema.parse({
            id: 'filesystem',
            type: 'stdio',
            command: process.execPath,
            args: [resolve('tests/integration/mock-backends/filesystem-mock.js')],
        });

        await manager.initializeAllBackends([config]);
        expect(manager.getAvailableTools().map((tool) => tool.name)).toContain('list_directory');
        expect(manager.getAllBackendStates()).toEqual([
            expect.objectContaining({ id: 'filesystem', isReady: true, toolCount: 2 }),
        ]);

        const result = await manager.executeOnBackend('filesystem', 'list_directory', { path: '/testpath' });
        expect(result.content).toEqual([
            { type: 'text', text: JSON.stringify({ files: ['file1.txt', 'file2.js'], path: '/testpath' }) },
        ]);
    });

    it('rejects unknown backends and tools', async () => {
        const manager = new BackendManager(initializeLogger({ logLevel: 'silent' }));
        managers.push(manager);
        await expect(manager.executeOnBackend('missing', 'tool', {})).rejects.toThrow('not ready');
    });

    it('marks an exited backend unavailable and removes its tools', async () => {
        const manager = new BackendManager(initializeLogger({ logLevel: 'silent' }));
        managers.push(manager);
        const unavailable = new Promise<string>((resolvePromise) => {
            manager.once('backendUnavailable', resolvePromise);
        });
        const config = BackendConfigSchema.parse({
            id: 'exiting',
            type: 'stdio',
            command: process.execPath,
            args: [resolve('tests/integration/mock-backends/exiting-mock.js')],
        });

        await manager.initializeAllBackends([config]);
        expect(manager.getAvailableTools()).toHaveLength(1);
        await expect(unavailable).resolves.toBe('exiting');
        expect(manager.getAvailableTools()).toHaveLength(0);
        expect(manager.getAllBackendStates()).toEqual([
            expect.objectContaining({
                id: 'exiting',
                isReady: false,
                toolCount: 1,
                error: 'Backend transport closed.',
            }),
        ]);
    });

    it('redacts exact secrets from backend initialization failures', async () => {
        let output = '';
        const destination = new Writable({
            write(chunk, _encoding, callback) {
                output += String(chunk);
                callback();
            },
        });
        const manager = new BackendManager(initializeLogger({ logLevel: 'debug' }, destination));
        managers.push(manager);
        const config = BackendConfigSchema.parse({
            id: 'failing',
            type: 'stdio',
            command: process.execPath,
            args: [resolve('tests/integration/mock-backends/initialization-error-mock.js')],
            env: { RUNTIME_VALUE: 'opaque-initialization-secret' },
        });

        const error = await manager.initializeBackend(config).catch((caught) => caught as Error);
        if (!(error instanceof Error)) {
            throw new Error('Expected backend initialization to fail.');
        }

        expect(error.message).toContain('[REDACTED]');
        expect(error.message).not.toContain('opaque-initialization-secret');
        expect(output).not.toContain('opaque-initialization-secret');
    });
});
