"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redactText = redactText;
exports.redactKnownSecrets = redactKnownSecrets;
exports.redactCommandArgs = redactCommandArgs;
exports.redactValue = redactValue;
exports.redactBackendConfig = redactBackendConfig;
exports.redactGatewayOptions = redactGatewayOptions;
const SENSITIVE_KEY_PATTERN = /(api[-_]?key|(?:^|[-_])key(?:$|[-_])|secret|token|password|authorization|(?:^|[-_])auth(?:$|[-_])|credential|cookie)/i;
const SENSITIVE_FLAG_PATTERN = /(api[-_]?key|(?:^|[-_])key(?:$|[-_])|secret|token|password|authorization|(?:^|[-_])auth(?:$|[-_])|credential)/i;
function redactText(value) {
    return value
        .replace(/\b([A-Za-z_][A-Za-z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*)\s*([=:])\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2[REDACTED]')
        .replace(/\b(Authorization\s*[:=]\s*)(?:Bearer|Basic)\s+[^\s,;]+/gi, '$1[REDACTED]')
        .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, 'gh_REDACTED')
        .replace(/\bnpm_[A-Za-z0-9]{20,}\b/g, 'npm_REDACTED')
        .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, 'xox_REDACTED')
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-REDACTED')
        .replace(/\bbb_[A-Za-z0-9_-]{8,}\b/g, 'bb_REDACTED')
        .replace(/\bAIza[A-Za-z0-9_-]{12,}\b/g, 'AIzaREDACTED');
}
function redactKnownSecrets(value, secrets) {
    return secrets
        .filter((secret) => secret.length >= 8)
        .sort((left, right) => right.length - left.length)
        .reduce((redacted, secret) => redacted.split(secret).join('[REDACTED]'), redactText(value));
}
function redactCommandArgs(args = []) {
    let redactNext = false;
    return args.map((argument) => {
        if (redactNext) {
            redactNext = false;
            return '[REDACTED]';
        }
        const equalsIndex = argument.indexOf('=');
        if (equalsIndex > 0 && SENSITIVE_FLAG_PATTERN.test(argument.slice(0, equalsIndex))) {
            return `${argument.slice(0, equalsIndex + 1)}[REDACTED]`;
        }
        if (argument.startsWith('-') && SENSITIVE_FLAG_PATTERN.test(argument)) {
            redactNext = true;
            return argument;
        }
        return redactText(argument);
    });
}
function redactValue(value, secrets = [], seen = new WeakSet()) {
    if (typeof value === 'string') {
        return redactKnownSecrets(value, secrets);
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (seen.has(value)) {
        return '[Circular]';
    }
    seen.add(value);
    if (Array.isArray(value)) {
        return value.map((item) => redactValue(item, secrets, seen));
    }
    const redacted = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        redacted[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactValue(nestedValue, secrets, seen);
    }
    return redacted;
}
function redactBackendConfig(config) {
    const environment = config.env || {};
    return {
        ...config,
        args: redactCommandArgs(config.args || []),
        env: Object.fromEntries(Object.keys(environment).map((key) => [key, '[REDACTED]'])),
    };
}
function redactGatewayOptions(options) {
    const { backends, ...otherOptions } = options;
    return {
        ...redactValue(otherOptions),
        backends: backends.map(redactBackendConfig),
    };
}
//# sourceMappingURL=redaction.js.map