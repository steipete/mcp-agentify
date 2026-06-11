#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const server_1 = require("./server");
const schemas_1 = require("./schemas");
const utils_1 = require("./utils");
function usage() {
    return `mcp-agentify ${(0, utils_1.getPackageVersion)()}

Usage:
  mcp-agentify --config <path> [--frontend-port <port>|--no-ui] [--model <model>]

Environment:
  OPENAI_API_KEY         Required OpenAI API key
  OPENAI_BASE_URL        Optional OpenAI-compatible API base URL
  OPENAI_MODEL           Overrides config openaiModel
  MCP_AGENTIFY_CONFIG    Default config path
  FRONTEND_PORT          Overrides config frontendPort; use "disabled" to disable
  LOG_LEVEL              Overrides config logLevel
  AGENTS                 Comma-separated openai/<model> entries for UI chat
`;
}
function parseArguments(argv) {
    const parsed = { help: false, version: false };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--help' || argument === '-h') {
            parsed.help = true;
        }
        else if (argument === '--version' || argument === '-v') {
            parsed.version = true;
        }
        else if (argument === '--config') {
            parsed.configPath = argv[++index];
        }
        else if (argument === '--frontend-port') {
            const port = Number.parseInt(argv[++index] || '', 10);
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                throw new Error('--frontend-port must be an integer between 1 and 65535.');
            }
            parsed.frontendPort = port;
        }
        else if (argument === '--no-ui') {
            parsed.frontendPort = null;
        }
        else if (argument === '--model') {
            parsed.model = argv[++index];
        }
        else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }
    return parsed;
}
function resolveConfigPath(cliPath) {
    const configuredPath = cliPath || process.env.MCP_AGENTIFY_CONFIG;
    if (configuredPath) {
        return (0, node_path_1.resolve)(configuredPath);
    }
    const defaultPath = (0, node_path_1.resolve)(process.cwd(), 'mcp-agentify.json');
    if ((0, node_fs_1.existsSync)(defaultPath)) {
        return defaultPath;
    }
    throw new Error('No config file found. Pass --config <path> or set MCP_AGENTIFY_CONFIG.');
}
function parseFrontendPort(value) {
    if (value === undefined) {
        return undefined;
    }
    if (value.toLowerCase() === 'disabled') {
        return null;
    }
    const port = Number.parseInt(value, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('FRONTEND_PORT must be an integer between 1 and 65535, or "disabled".');
    }
    return port;
}
async function main() {
    const cli = parseArguments(process.argv.slice(2));
    if (cli.help) {
        process.stdout.write(usage());
        return;
    }
    if (cli.version) {
        process.stdout.write(`${(0, utils_1.getPackageVersion)()}\n`);
        return;
    }
    const configPath = resolveConfigPath(cli.configPath);
    const fileConfig = schemas_1.GatewayFileConfigSchema.parse(JSON.parse((0, node_fs_1.readFileSync)(configPath, 'utf8')));
    const environmentFrontendPort = parseFrontendPort(process.env.FRONTEND_PORT);
    const agents = process.env.AGENTS
        ? process.env.AGENTS.split(',')
            .map((agent) => agent.trim())
            .filter(Boolean)
        : fileConfig.agents;
    const frontendPort = cli.frontendPort !== undefined
        ? cli.frontendPort
        : environmentFrontendPort !== undefined
            ? environmentFrontendPort
            : fileConfig.frontendPort;
    const options = schemas_1.GatewayOptionsSchema.parse({
        ...fileConfig,
        configPath,
        openaiApiKey: process.env.OPENAI_API_KEY,
        openaiBaseUrl: process.env.OPENAI_BASE_URL,
        openaiModel: cli.model || process.env.OPENAI_MODEL || fileConfig.openaiModel,
        logLevel: process.env.LOG_LEVEL || fileConfig.logLevel,
        frontendPort,
        agents,
    });
    await (0, server_1.startAgentifyServer)(options);
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`mcp-agentify: ${message}\n`);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map