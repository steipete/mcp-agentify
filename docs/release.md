# Release readiness

## Package identity

The unscoped npm package [`mcp-agentify`](https://www.npmjs.com/package/mcp-agentify) is an unrelated REST API-to-MCP generator published by a different owner. This repository must never publish that package name.

This project uses [`@steipete/mcp-agentify`](https://www.npmjs.com/package/@steipete/mcp-agentify) and retains the `mcp-agentify` executable.

## First scoped release

Before publishing:

1. Confirm authenticated npm identity controls the `@steipete` scope.
2. Confirm `npm view @steipete/mcp-agentify` is absent or belongs to this repository.
3. Run `npm ci`, `npm run lint`, `npm test`, and `npm pack --dry-run --json`.
4. Install the exact tarball into a temporary project.
5. Live-test MCP discovery and calls with supported filesystem and Browserbase backends.
6. Verify logs and dashboard responses contain no credential values.
7. Publish `@steipete/mcp-agentify` with public access.
8. Create the matching Git tag and GitHub Release with changelog, npm version URL, registry tarball, integrity, and CI proof.
9. Verify registry version, `latest` dist-tag, tarball, integrity, publish time, Git tag, and GitHub Release.
10. Add the next patch heading under `Unreleased` and commit the release closeout.

Version changes happen only as part of the explicit release operation.
