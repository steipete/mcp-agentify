import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn as actualSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import * as rpcNodeMock from 'vscode-jsonrpc/node';
import type { MessageConnection } from 'vscode-jsonrpc/node';
import type { Readable, Writable } from 'node:stream';

import { BackendManager } from '../../src/backendManager';
import type { BackendConfig, BackendStdioConfig } from '../../src/interfaces';
import { initializeLogger, resetLoggerForTest } from '../../src/logger';
import type { Logger as PinoLogger } from 'pino';

vi.mock('node:child_process');
vi.mock('vscode-jsonrpc/node');

const mockSpawn = actualSpawn as vi.Mock;
const mockCreateMessageConnection = rpcNodeMock.createMessageConnection as vi.Mock;
const mockMessageConnectionInstance = rpcNodeMock.mockMessageConnectionInstance as Partial<MessageConnection> & {
    [key: string]: vi.Mock;
};

let mockSpawnedProcess: MockChildProcess;
class MockChildProcess extends EventEmitter {
    stdout: Readable & { unpipe?: () => void };
    stderr: Readable & { unpipe?: () => void };
    stdin: Writable & { unpipe?: () => void };
    pid? = 1234;
    killed: boolean = false;
    kill = vi.fn((signal?: NodeJS.Signals | number) => {
        this.killed = true;
        this.emit('exit', signal === 'SIGKILL' ? null : 0, signal);
        return true;
    });
    constructor() {
        super();
        this.stdout = new EventEmitter() as any;
        this.stderr = new EventEmitter() as any;
        this.stdin = new EventEmitter() as any;
    }
}

const mockPinoLogger = initializeLogger({ logLevel: 'silent' });
const validBackendConfig: BackendStdioConfig = {
    id: 'test-backend',
    type: 'stdio',
    command: 'node',
    args: ['test-script.js'],
    displayName: 'Test Backend',
};

describe('BackendManager', () => {
    let backendManager: BackendManager;

    beforeEach(() => {
        resetLoggerForTest();
        mockSpawn.mockReset();

        mockCreateMessageConnection.mockReset();
        mockCreateMessageConnection.mockReturnValue(mockMessageConnectionInstance as MessageConnection);

        if (mockMessageConnectionInstance) {
            for (const key in mockMessageConnectionInstance) {
                const mockFn = (mockMessageConnectionInstance as any)[key] as vi.Mock;
                if (typeof mockFn?.mockReset === 'function') {
                    mockFn.mockReset();
                }
            }
        } else {
            console.error(
                'CRITICAL TEST SETUP ERROR: mockMessageConnectionInstance is undefined in beforeEach after mock setup.',
            );
        }

        mockSpawnedProcess = new MockChildProcess();
        mockSpawn.mockReturnValue(mockSpawnedProcess);

        backendManager = new BackendManager(mockPinoLogger.child({ test: 'BackendManager' }));
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('initializeBackend', () => {
        it('should spawn process, create connection, and send initialize request successfully', async () => {
            if (!mockMessageConnectionInstance?.sendRequest) throw new Error('mock connection not setup');
            (mockMessageConnectionInstance.sendRequest as vi.Mock).mockResolvedValueOnce({ capabilities: {} });
            (mockMessageConnectionInstance.sendRequest as vi.Mock).mockResolvedValueOnce({ capabilities: {} });

            const success = await backendManager.initializeBackend(validBackendConfig);
            expect(success).toBe(true);
            expect(mockSpawn).toHaveBeenCalledWith(
                validBackendConfig.command,
                validBackendConfig.args,
                expect.any(Object),
            );
            expect(mockCreateMessageConnection).toHaveBeenCalledOnce();
            expect(mockMessageConnectionInstance.listen).toHaveBeenCalledOnce();
            expect(mockMessageConnectionInstance.sendRequest).toHaveBeenCalledWith('initialize', expect.any(Object));
            const instance = backendManager.getBackendInstance(validBackendConfig.id);
            expect(instance).toBeDefined();
            expect(instance?.isReady).toBe(true);
        });

        it('should return false and log error if backend type is not stdio', async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const nonStdioConfig = { ...validBackendConfig, type: 'other' as any };
            const success = await backendManager.initializeBackend(nonStdioConfig);
            expect(success).toBe(false);
            expect(mockSpawn).not.toHaveBeenCalled();
        });

        it('should return false if spawn throws an error', async () => {
            mockSpawn.mockImplementationOnce(() => {
                throw new Error('Spawn failed');
            });
            const success = await backendManager.initializeBackend(validBackendConfig);
            expect(success).toBe(false);
        });

        it('should return false and set not ready if initialize request fails', async () => {
            if (!mockMessageConnectionInstance?.sendRequest) throw new Error('mock conn not setup');
            (mockMessageConnectionInstance.sendRequest as vi.Mock).mockRejectedValueOnce(
                new Error('Initialize rejected'),
            );

            const success = await backendManager.initializeBackend(validBackendConfig);
            expect(success).toBe(false);
            const instance = backendManager.getBackendInstance(validBackendConfig.id);
            expect(instance).toBeUndefined();
        });

        it('should handle process error event', async () => {
            await backendManager.initializeBackend(validBackendConfig);
            mockSpawnedProcess.emit('error', new Error('Process crashed'));
            const instance = backendManager.getBackendInstance(validBackendConfig.id);
            if (instance) {
                expect(instance.isReady).toBe(false);
            } else {
                expect(backendManager.getBackendInstance(validBackendConfig.id)).toBeUndefined();
            }
        });

        it('should handle process exit event', async () => {
            if (!mockMessageConnectionInstance?.sendRequest || !mockMessageConnectionInstance?.dispose)
                throw new Error('mock conn not setup');
            (mockMessageConnectionInstance.sendRequest as vi.Mock).mockImplementation(async (method) => {
                if (method === 'initialize') return { capabilities: {} };
                return {};
            });
            await backendManager.initializeBackend(validBackendConfig);
            mockSpawnedProcess.emit('exit', 0, null);
            expect(backendManager.getBackendInstance(validBackendConfig.id)).toBeUndefined();
            expect(mockMessageConnectionInstance.dispose).toHaveBeenCalled();
        });
    });

    describe('executeOnBackend', () => {
        beforeEach(async () => {
            if (!mockMessageConnectionInstance?.sendRequest) throw new Error('mock conn not setup for exec');
            (mockMessageConnectionInstance.sendRequest as vi.Mock).mockResolvedValueOnce({ capabilities: {} });
            await backendManager.initializeBackend(validBackendConfig);
            (mockMessageConnectionInstance.sendRequest as vi.Mock).mockReset();
        });

        it('should execute request on a ready backend', async () => {
            if (!mockMessageConnectionInstance?.sendRequest) throw new Error('mock conn not setup for exec test');
            (mockMessageConnectionInstance.sendRequest as vi.Mock).mockResolvedValueOnce({ data: 'success' });

            const result = await backendManager.executeOnBackend(validBackendConfig.id, 'test/request', { p: 1 });
            expect(result).toEqual({ data: 'success' });
            expect(mockMessageConnectionInstance.sendRequest).toHaveBeenCalledWith('test/request', { p: 1 });
        });

        it('should throw if backend not found', async () => {
            await expect(backendManager.executeOnBackend('nonexistent', 'm', {})).rejects.toThrow(
                'Backend nonexistent not found',
            );
        });

        it('should throw if backend is not ready', async () => {
            const instance = backendManager.getBackendInstance(validBackendConfig.id);
            if (instance) instance.isReady = false;
            await expect(backendManager.executeOnBackend(validBackendConfig.id, 'm', {})).rejects.toThrow(
                'Backend test-backend is not ready',
            );
        });

        it('should throw if connection sendRequest fails during execute', async () => {
            if (!mockMessageConnectionInstance?.sendRequest) throw new Error('mock conn not setup');
            (mockMessageConnectionInstance.sendRequest as vi.Mock).mockRejectedValueOnce(new Error('RPC failed'));

            await expect(backendManager.executeOnBackend(validBackendConfig.id, 'test/fail', {})).rejects.toThrow(
                'RPC failed',
            );
        });
    });

    describe('shutdownAllBackends', () => {
        it('should send shutdown/exit notifications, dispose connection, and kill process', async () => {
            if (
                !mockMessageConnectionInstance?.sendRequest ||
                !mockMessageConnectionInstance?.sendNotification ||
                !mockMessageConnectionInstance?.dispose
            )
                throw new Error('mock conn not setup for shutdown');
            (mockMessageConnectionInstance.sendRequest as vi.Mock).mockResolvedValue({ capabilities: {} });
            await backendManager.initializeBackend(validBackendConfig);
            const instance = backendManager.getBackendInstance(validBackendConfig.id);
            if (instance) instance.isReady = true;

            await backendManager.shutdownAllBackends();

            expect(mockMessageConnectionInstance.sendNotification).toHaveBeenCalledWith('shutdown');
            expect(mockMessageConnectionInstance.sendNotification).toHaveBeenCalledWith('exit');
            expect(mockMessageConnectionInstance.dispose).toHaveBeenCalled();
            expect(mockSpawnedProcess.kill).toHaveBeenCalledWith('SIGTERM');
        }, 10000);
    });
});
