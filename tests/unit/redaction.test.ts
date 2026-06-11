import { describe, expect, it } from 'vitest';
import {
    redactBackendConfig,
    redactCommandArgs,
    redactGatewayOptions,
    redactKnownSecrets,
    redactText,
    redactValue,
} from '../../src/redaction';

describe('redaction', () => {
    it('redacts sensitive object fields recursively', () => {
        expect(
            redactValue({
                OPENAI_API_KEY: 'sk-secret-value',
                nested: {
                    authorization: 'Bearer secret',
                    key: 'opaque-key',
                    auth: 'opaque-auth',
                    visible: 'ok',
                },
            }),
        ).toEqual({
            OPENAI_API_KEY: '[REDACTED]',
            nested: {
                authorization: '[REDACTED]',
                key: '[REDACTED]',
                auth: '[REDACTED]',
                visible: 'ok',
            },
        });
    });

    it('redacts command-line secret values', () => {
        expect(
            redactCommandArgs([
                '--modelApiKey',
                'sk-secret-value',
                '--key',
                'opaque-production-key',
                '--auth=opaque-auth-value',
                '--port',
                '3000',
            ]),
        ).toEqual(['--modelApiKey', '[REDACTED]', '--key', '[REDACTED]', '--auth=[REDACTED]', '--port', '3000']);
    });

    it('redacts backend environment values', () => {
        expect(
            redactBackendConfig({
                id: 'browser',
                type: 'stdio',
                command: 'node',
                args: [],
                env: { TOKEN: 'secret' },
                inheritEnv: [],
                startupTimeoutMs: 30_000,
            }),
        ).toMatchObject({ env: { TOKEN: '[REDACTED]' } });
    });

    it('redacts every backend environment value in gateway options', () => {
        expect(
            redactGatewayOptions({
                backends: [
                    {
                        id: 'browser',
                        type: 'stdio',
                        command: 'node',
                        args: [],
                        env: { KEY: 'opaque-secret' },
                        inheritEnv: [],
                        startupTimeoutMs: 30_000,
                    },
                ],
                logLevel: 'info',
                frontendPort: 3030,
                openaiModel: 'test-model',
                agents: ['openai/test-model'],
                openaiApiKey: 'sk-secret-value',
            }),
        ).toMatchObject({
            openaiApiKey: '[REDACTED]',
            backends: [{ env: { KEY: '[REDACTED]' } }],
        });
    });

    it('redacts common plain-text credential formats', () => {
        const text = [
            'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456',
            'Authorization: Bearer opaque-token-value',
            'npm_abcdefghijklmnopqrstuvwxyz123456',
            'xoxb-1234567890-abcdefghijklmnopqrstuvwxyz',
        ].join(' ');

        expect(redactText(text)).not.toMatch(/ghp_|opaque-token-value|npm_[a-z]|xoxb-/);
    });

    it('redacts exact forwarded secrets without recognizable prefixes', () => {
        expect(redactKnownSecrets('backend said custom-secret-value', ['custom-secret-value'])).toBe(
            'backend said [REDACTED]',
        );
        expect(redactValue({ output: 'custom-secret-value' }, ['custom-secret-value'])).toEqual({
            output: '[REDACTED]',
        });
    });
});
