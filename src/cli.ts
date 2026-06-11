#!/usr/bin/env node

import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startAgentifyServer } from './server';
import { GatewayFileConfigSchema, GatewayOptionsSchema } from './schemas';
import { getPackageVersion } from './utils';

interface CliArguments {
    configPath?: string;
    frontendPort?: number | null;
    model?: string;
    help: boolean;
    version: boolean;
}

function usage(): string {
    return `mcp-agentify ${getPackageVersion()}

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

function parseArguments(argv: string[]): CliArguments {
    const parsed: CliArguments = { help: false, version: false };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--help' || argument === '-h') {
            parsed.help = true;
        } else if (argument === '--version' || argument === '-v') {
            parsed.version = true;
        } else if (argument === '--config') {
            parsed.configPath = argv[++index];
        } else if (argument === '--frontend-port') {
            const port = Number.parseInt(argv[++index] || '', 10);
            if (!Number.isInteger(port) || port < 1 || port > 65_535) {
                throw new Error('--frontend-port must be an integer between 1 and 65535.');
            }
            parsed.frontendPort = port;
        } else if (argument === '--no-ui') {
            parsed.frontendPort = null;
        } else if (argument === '--model') {
            parsed.model = argv[++index];
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }
    return parsed;
}

function resolveConfigPath(cliPath?: string): string {
    const configuredPath = cliPath || process.env.MCP_AGENTIFY_CONFIG;
    if (configuredPath) {
        return resolve(configuredPath);
    }

    const defaultPath = resolve(process.cwd(), 'mcp-agentify.json');
    if (existsSync(defaultPath)) {
        return defaultPath;
    }
    throw new Error('No config file found. Pass --config <path> or set MCP_AGENTIFY_CONFIG.');
}

function parseFrontendPort(value: string | undefined): number | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value.toLowerCase() === 'disabled') {
        return null;
    }
    const port = Number.parseInt(value, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error('FRONTEND_PORT must be an integer between 1 and 65535, or "disabled".');
    }
    return port;
}

async function main(): Promise<void> {
    const cli = parseArguments(process.argv.slice(2));
    if (cli.help) {
        process.stdout.write(usage());
        return;
    }
    if (cli.version) {
        process.stdout.write(`${getPackageVersion()}\n`);
        return;
    }

    const configPath = resolveConfigPath(cli.configPath);
    const fileConfig = GatewayFileConfigSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')) as unknown);
    const environmentFrontendPort = parseFrontendPort(process.env.FRONTEND_PORT);
    const agents = process.env.AGENTS
        ? process.env.AGENTS.split(',')
              .map((agent) => agent.trim())
              .filter(Boolean)
        : fileConfig.agents;
    const frontendPort =
        cli.frontendPort !== undefined
            ? cli.frontendPort
            : environmentFrontendPort !== undefined
              ? environmentFrontendPort
              : fileConfig.frontendPort;

    const options = GatewayOptionsSchema.parse({
        ...fileConfig,
        configPath,
        openaiApiKey: process.env.OPENAI_API_KEY,
        openaiBaseUrl: process.env.OPENAI_BASE_URL,
        openaiModel: cli.model || process.env.OPENAI_MODEL || fileConfig.openaiModel,
        logLevel: process.env.LOG_LEVEL || fileConfig.logLevel,
        frontendPort,
        agents,
    });

    await startAgentifyServer(options);
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`mcp-agentify: ${message}\n`);
    process.exit(1);
});
