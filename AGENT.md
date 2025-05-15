---
description: Core agent guidelines for mcp-agentify development. This is the primary, always-applied rule set.
alwaysApply: true
---

# Core Agent Instructions & Guidelines

## I. Overall Behavior & Principles

-   **Be Proactive & Solution-Oriented:** Don't just identify problems; actively propose and implement solutions. If a path is blocked, suggest alternatives.
-   **Conciseness:** Keep responses and explanations clear and to the point, especially in `AGENT.MD` itself. More verbose explanations can go into supporting rule files.
-   **Tool Usage First:** Prefer using available tools over asking the user for information you can find yourself (e.g., reading files, listing directories, searching code).
-   **No Apologies/Personification:** Avoid phrases like "I apologize," "As an AI," "I can't." Focus on the task.
-   **Follow Instructions:** Adhere strictly to user instructions, project rules (like this one and others in `.cursor/rules/`), and established conventions.
-   **Iterative Refinement:** This document (`AGENT.MD`) and supporting rules should be updated with learnings from our interactions (see `@update_agent_guidelines`).

## II. File Handling & Paths

-   **Absolute Paths for `mcp_filesystem_*`:**
    -   **CRITICAL:** `mcp_filesystem_*` tools (e.g., `mcp_filesystem_write_file`, `mcp_filesystem_edit_file`): ALWAYS use absolute paths.
    -   The project workspace root is: `/Users/steipete/Projects/mcp-agentify`.
    -   Relative paths WILL fail or have unintended consequences.
-   **Targeting Symlinked Rule Files:** When editing primary agent rules or other rules symlinked into `.cursor/rules/` (like this `agent.mdc` itself), target the symlink path (e.g., `.cursor/rules/agent.mdc`) for `edit_file` operations to ensure proper integration with Cursor's rule management.

## III. Tool Usage & Execution Environment

-   **`run_terminal_cmd` / iTerm Tools for Node.js Scripts:**
    -   **CRITICAL CWD Fix:** For Node.js scripts (especially using `tsx` or `npx`), ALWAYS ensure the Current Working Directory (CWD) is the project root. Prepend `cd /Users/steipete/Projects/mcp-agentify && ` to your command string if the script's path resolution or file system operations are relative to the project root.
    -   (See `@debugging_frontend_e2e` for more CWD debugging details).
-   **Express CWD Fix (FrontendServer / Similar):**
    -   If an Express application (like `FrontendServer`) exhibits CWD-related issues (e.g., `ENOENT` for static files) despite a correct launch CWD, forcefully set the CWD within its constructor using `process.chdir(this.projectRoot)` *after* `this.projectRoot` has been initialized from configuration.
    -   (See `@debugging_frontend_e2e` for implementation details).
-   **Playwright Tools:**
    -   **Fresh Test Sessions:** After server restarts or frontend rebuilds, ALWAYS call `playwright_close` *before* `playwright_navigate` to ensure a completely fresh browser context and avoid issues with stale cached page states.
    -   (See `@debugging_frontend_e2e` for more on frontend caching).
-   **`edit_file` Tool (Use with Caution for Full Overwrites):**
    -   For precise changes, use with `// ... existing code ...`.
    -   If replacing entire content, ensure the `code_edit` field contains the *complete new file content*. For large overwrites, `mcp_filesystem_write_file` is generally safer if path permissions allow, but we found it was restricted for `.cursor/rules/`. So, `edit_file` with full content is the fallback.

## IV. Debugging Strategies

-   **UI Not Updating After Backend Changes?**
    1.  Strongly suspect frontend build/browser caching.
    2.  Request a full frontend rebuild (delete caches like `.parcel-cache`, `frontend/public`, then run build script e.g., `npm run build:ui`).
    3.  When testing with Playwright, **always** use `playwright_close` before `playwright_navigate`.
    4.  (Detailed steps: `@debugging_frontend_e2e`).
-   **API Request Failures (e.g., UI -> Server, HTTP 400/500):**
    1.  Log request payload at client-side (`console.log` in UI code).
    2.  Log raw `req.body`/`req.headers` at server API endpoint start.
    3.  Log parsed params after server endpoint parsing.
    4.  Trace calls to internal services (e.g., `LLMOrchestratorService`), logging input and output.
    5.  **Crucially, ensure services are initialized & passed to handlers *before* requests can arrive.** Prefer constructor injection.
    6.  (Detailed workflow for this: `@debugging_frontend_e2e`).

## V. Code Style & Conventions

-   **Formatting:** Adhere to the project's Prettier configuration. The reference config is:
    ```json
    {
      "semi": true,
      "trailingComma": "all",
      "singleQuote": true,
      "printWidth": 120,
      "tabWidth": 4
    }
    ```
-   **Comments:** Clear, concise comments for non-obvious code. Avoid over-commenting.
-   **Error Handling:** Implement robust error handling. Log with context, return meaningful error responses.

## VI. Task Management & Workflow (If using Task Master)

- Refer to `@dev_workflow` for detailed processes.
- Prioritize MCP server tools over CLI commands.

## VII. Updating These Guidelines
- This process is defined in `@update_agent_guidelines`.
- After significant debugging sessions or new patterns emerge, suggest a review.

## VIII. Version Control & Committing

- **Committing Changes Instruction ("commit"):**
  - When instructed to "commit," identify all uncommitted (dirty) files (`git status`).
  - Group these changes into logical commits. If multiple distinct features or fixes are present, create separate commits for each.
  - For each logical chunk:
      - Stage the relevant files (`git add <file1> <file2> ...`).
      - Formulate a clear, descriptive commit message (e.g., `feat: ...`, `fix: ...`, `docs: ...`).
      - Commit the staged changes (`git commit -m "..."`).
  - After all logical commits are made, **always** run `git push` to push all new local commits to the remote branch.
  - Report the outcome of the push.

---