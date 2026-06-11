import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { getLogger, initializeLogger, resetLoggerForTest } from '../../src/logger';

describe('logger', () => {
    afterEach(() => resetLoggerForTest());

    it('uses the configured level and returns the active instance', () => {
        const logger = initializeLogger({ logLevel: 'debug' });
        expect(logger.level).toBe('debug');
        expect(getLogger()).toBe(logger);
    });

    it('writes structured logs to an injected destination', () => {
        let output = '';
        const destination = new Writable({
            write(chunk, _encoding, callback) {
                output += String(chunk);
                callback();
            },
        });
        const logger = initializeLogger({ logLevel: 'info' }, destination);
        logger.info({ component: 'test' }, 'ready');
        expect(JSON.parse(output)).toMatchObject({
            level: 30,
            component: 'test',
            msg: 'ready',
        });
    });

    it('filters messages below the configured level', () => {
        let output = '';
        const destination = new Writable({
            write(chunk, _encoding, callback) {
                output += String(chunk);
                callback();
            },
        });
        const logger = initializeLogger({ logLevel: 'warn' }, destination);
        logger.info('hidden');
        logger.warn('visible');
        expect(output).not.toContain('hidden');
        expect(output).toContain('visible');
    });

    it('redacts credentials from serialized errors', () => {
        let output = '';
        const destination = new Writable({
            write(chunk, _encoding, callback) {
                output += String(chunk);
                callback();
            },
        });
        const logger = initializeLogger({ logLevel: 'info' }, destination);
        logger.error({ err: new Error('Rejected sk-test-never-log-this-value') }, 'Provider failed.');

        expect(output).toContain('sk-REDACTED');
        expect(output).not.toContain('sk-test-never-log-this-value');
    });
});
