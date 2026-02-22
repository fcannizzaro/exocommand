# AGENTS.md

## Project Overview

Exocommand is an MCP (Model Context Protocol) server that exposes user-defined shell
commands as tools for AI coding assistants. Written in TypeScript, it runs on Bun and
publishes as an npm package (`@fcannizzaro/exocommand`).

## Build & Development

```bash
bun install          # Install dependencies
bun run build        # Compile TS to dist/, then postbuild adds shebang + chmod
bun run src/index.ts # Run dev server (serves MCP endpoint at http://127.0.0.1:5555/mcp)
```

There is no dedicated lint or format command. TypeScript strict mode is the primary
enforcement mechanism.

## Testing

Tests use Bun's built-in test runner (`bun:test`) with `describe`/`test`/`expect`.

```bash
# Run all tests
bun test

# Run a specific test file
bun test src/config.test.ts
bun test src/executor.test.ts

# Run a single test by name pattern
bun test --grep "parses valid config with commands"
```

Test files live alongside source files as `<name>.test.ts`:
- `src/config.test.ts` — config parsing and validation (28 cases)
- `src/executor.test.ts` — command execution, stderr, abort/cancellation (11 cases)

## Code Style

### Formatting

- **Indentation**: 2 spaces, no tabs
- **Semicolons**: always
- **Quotes**: double quotes (`"`) everywhere; single quotes only inside shell strings in tests
- **Trailing commas**: always (function params, objects, arrays)
- **Line length**: soft limit ~120 characters
- **Trailing newline**: every file ends with a newline
- **Long expressions**: break with closing delimiters on their own line, aligned:
  ```typescript
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request" },
    },
    { status: 400 },
  );
  ```

### Imports

Imports are grouped in order, without blank lines between groups:
1. Node built-ins (always use the `node:` prefix)
2. Third-party packages
3. Local project modules

```typescript
import { watch } from "node:fs";
import { getRequestListener } from "@hono/node-server";
import { loadConfig } from "./config.js";
```

- **Source files**: use `.js` extensions on relative imports (`"./config.js"`)
  — required by `verbatimModuleSyntax`.
- **Test files**: omit `.js` extensions (`"./config"`) — Bun resolves them at runtime.
- **Type-only imports**: use inline `type` keyword when mixed (`import { type McpServer }`),
  or standalone `import type` when the entire import is types (`import type { Logger }`).

### Types

- **Interfaces** for object shapes (`interface ExoConfig { ... }`).
- **Type aliases** for function signatures and unions (`type LogCallback = (...) => ...`).
- **No `I` prefix** on interfaces.
- **Explicit return types** on all functions (exported and non-exported).
- **`as const`** for literal types in returned objects (`type: "text" as const`).
- **Type assertions** use `as` syntax, never angle-bracket (`(err as Error).message`).
- **Conditional spread** for optional properties: `...(cwd ? { cwd } : {})`.

TypeScript is configured with strict mode plus additional flags:
- `strict: true`
- `verbatimModuleSyntax: true`
- `noUncheckedIndexedAccess: true`
- `noFallthroughCasesInSwitch: true`
- `noImplicitOverride: true`

### Naming Conventions

| Element       | Convention         | Examples                                    |
| ------------- | ------------------ | ------------------------------------------- |
| Files         | `camelCase.ts`     | `config.ts`, `executor.ts`, `logger.ts`     |
| Test files    | `name.test.ts`     | `config.test.ts`, `executor.test.ts`        |
| Directories   | lowercase          | `src/`, `scripts/`, `dist/`                 |
| Variables     | camelCase          | `configExists`, `debounceTimer`             |
| Functions     | camelCase          | `loadConfig`, `executeCommand`, `handleMcp` |
| Interfaces    | PascalCase         | `ExoCommand`, `ExoConfig`, `Logger`         |
| Type aliases  | PascalCase         | `LogCallback`, `LogEntry`                   |
| Constants     | UPPER_SNAKE_CASE   | `CONFIG_PATH`, `NAME_PATTERN`, `RESET`      |

### Exports

- **Named exports only** — no `export default` anywhere in the codebase.
- Private symbols are simply not exported.
- No barrel files; each module is imported directly.

### Error Handling

- **Configuration errors**: `throw new Error(message)` to propagate up.
- **Ignorable failures** (process already exited, client disconnected): empty `catch {}` with
  a comment explaining why it's safe to ignore.
- **Logging errors**: `catch (err)` with `(err as Error).message` — no custom error classes.
- **MCP tool errors**: return structured content with `isError: true` rather than throwing:
  ```typescript
  return {
    content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
    isError: true,
  };
  ```
- Omit the `catch` binding when the error object is not needed (`catch {`).

### Comments

- `//` inline comments only — no JSDoc.
- Explain **why**, not what.
- Section headers as short labels: `// Parse port`, `// Parse commands`.
- Inline excuse comments for ignored errors: `// process may have already exited`.

### Testing Patterns

- Import from `bun:test` (`describe`, `test`, `expect`, `beforeAll`, `afterAll`).
- Co-locate tests next to source as `<name>.test.ts`.
- Use factory helpers for test setup (e.g., `createLogCollector()`).
- Temporary files in tests are cleaned up with `afterAll`.

## Dependencies

Minimize external dependencies. Prefer Bun built-ins (`Bun.file`, `Bun.spawn`,
`Bun.serve`) over Node.js equivalents or third-party packages where practical.

## Commit Conventions

Use conventional commit prefixes:

```
feat: add support for command timeouts
fix: handle missing config file gracefully
refactor: simplify session management
docs: update README examples
chore: bump dependencies
```

## CI

The publish workflow (`.github/workflows/publish.yaml`) is manually triggered and runs:
`bun install` → `bun run build` → `bun test` → `npm publish`. There are no automated
checks on push or PR.

## Important

You can run some commands on the machine, find them with "listCommands()" and run them with "execute(name,timeout?)".
