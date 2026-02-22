# Contributing to exocommand

Thanks for your interest in contributing! This guide will help you get set up and submit your changes.

## Getting Started

1. Fork and clone the repository:

```bash
git clone https://github.com/<your-username>/exocommand.git
cd exocommand
```

2. Install dependencies:

```bash
bun install
```

3. Start the server:

```bash
bun run index.ts
```

The MCP server will be available at `http://127.0.0.1:5555/mcp`. You can configure commands in the `.exocommand` file (see the [README](README.md) for details).

## Project Structure

| File | Purpose |
| --- | --- |
| `index.ts` | Entry point. Sets up the HTTP server, manages MCP sessions, and watches the config file for changes. |
| `src/server.ts` | Creates the `McpServer` instance and registers the `listCommands` and `execute` tools. |
| `src/config.ts` | Parses and validates the `.exocommand` YAML config file. |
| `src/executor.ts` | Spawns shell commands, streams output, and handles cancellation. |
| `src/logger.ts` | Colored console logger with timestamps. |

## Development Workflow

1. Create a branch for your change:

```bash
git checkout -b feat/my-feature
```

2. Make your changes and test them manually by starting the server and connecting an MCP client (e.g., [OpenCode](https://opencode.ai)).

3. Verify that the server starts without errors and your changes work as expected through the `/mcp` endpoint.

> There is no automated test suite yet. If your change is well-suited for tests, consider adding them using `bun test`.

## Submitting Changes

1. Commit your changes with a clear, concise message:

```bash
git commit -m "feat: add support for command timeouts"
```

   Use a prefix that describes the type of change: `feat`, `fix`, `refactor`, `docs`, `chore`.

2. Push your branch and open a Pull Request against `main`.

3. In the PR description, explain **what** the change does and **why** it's needed. If relevant, include steps to reproduce or test.

## Reporting Bugs

Open an [issue](https://github.com/fcannizzaro/exocommand/issues) and include:

- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, Bun version)

## Code Style

- **TypeScript** -- all source files use TypeScript.
- **Bun APIs** -- prefer Bun built-ins (`Bun.file`, `Bun.spawn`, `Bun.serve`) over Node.js equivalents or third-party packages.
- **Minimal dependencies** -- avoid adding new dependencies unless strictly necessary.
- **Naming** -- command names in `.exocommand` must match `[a-zA-Z0-9_-]+`.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
