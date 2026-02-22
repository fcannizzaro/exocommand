

type CliAction =
  | { kind: "serve" }
  | { kind: "add"; path: string }
  | { kind: "ls" }
  | { kind: "rm"; target: string }
  | { kind: "init" };

export function parseArgs(argv: string[]): CliAction {
  const args = argv.slice(2);

  if (args.length === 0) {
    return { kind: "serve" };
  }

  const subcommand = args[0]!;

  switch (subcommand) {
    case "add": {
      const target = args[1];
      if (!target) {
        throw new Error("Usage: exocommand add <path-to-.exocommand-or-directory>");
      }
      return { kind: "add", path: target };
    }
    case "ls":
      return { kind: "ls" };
    case "init":
      return { kind: "init" };
    case "rm": {
      const target = args[1];
      if (!target) {
        throw new Error("Usage: exocommand rm <access-key-or-path>");
      }
      return { kind: "rm", target };
    }
    default:
      throw new Error(`Unknown subcommand "${subcommand}". Available: add, init, ls, rm`);
  }
}


