// tests/__mocks__/vscode-jsonrpc/node.ts
import { vi } from 'vitest';
import type { MessageConnection } from 'vscode-jsonrpc/node'; // For type

export const mockMessageConnectionInstance: Partial<MessageConnection> = {
    listen: vi.fn(),
    sendRequest: vi.fn(),
    sendNotification: vi.fn(),
    dispose: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
    onNotification: vi.fn(),
    onRequest: vi.fn(),
};

export const createMessageConnection = vi.fn().mockReturnValue(mockMessageConnectionInstance as MessageConnection);

// Re-export other things if SUT actually uses them from here (like ErrorCodes, RequestType)
// For now, assuming SUT from backendManager.ts mainly uses createMessageConnection and MessageConnection type.
// If RequestType/NotificationType classes are newed up from 'vscode-jsonrpc/node' in SUT, they need mock here.
// From backendManager.ts: NotificationType and RequestType are imported.

export class NotificationType<P> {
    constructor(public method: string) {}
}

export class RequestType<P, R, E> {
    constructor(public method: string) {}
}

export enum ErrorCodes {
    ParseError = -32700,
    InvalidRequest = -32600,
    MethodNotFound = -32601,
    InvalidParams = -32602,
    InternalError = -32603,
} 