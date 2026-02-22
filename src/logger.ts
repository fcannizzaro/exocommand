const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

export interface Logger {
  info(event: string, message: string): void;
  success(event: string, message: string): void;
  warn(event: string, message: string): void;
  error(event: string, message: string): void;
}

function timestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function format(
  color: string,
  event: string,
  message: string,
  agentId?: number,
): string {
  const agent =
    agentId !== undefined
      ? ` ${DIM}[agent ${agentId}]${RESET}`
      : "";
  return `${DIM}${timestamp()}${RESET}${agent} ${color}${BOLD}[${event}]${RESET} ${message}`;
}

function createLogger(agentId?: number): Logger {
  return {
    info(event: string, message: string): void {
      console.log(format(CYAN, event, message, agentId));
    },
    success(event: string, message: string): void {
      console.log(format(GREEN, event, message, agentId));
    },
    warn(event: string, message: string): void {
      console.warn(format(YELLOW, event, message, agentId));
    },
    error(event: string, message: string): void {
      console.error(format(RED, event, message, agentId));
    },
  };
}

export const logger = {
  ...createLogger(),
  banner(version: string): void {
    const v = `v${version}`;
    // 32-char wide interior: "  ● ○ ○" (7 chars) + padding + version + "  " (2 trailing)
    const dotsLeft = "  ● ○ ○";
    const padLen = 32 - dotsLeft.length - v.length - 2;
    const pad = " ".repeat(Math.max(padLen, 1));

    const lines = [
      `${DIM}  ╭────────────────────────────────╮${RESET}`,
      `${DIM}  │${RESET}  ${RED}●${RESET} ${DIM}○ ○${pad}${v}${RESET}  ${DIM}│${RESET}`,
      `${DIM}  │${RESET}  ${GREEN}>${RESET} ${BOLD}${CYAN}EXOCOMMAND${RESET}${GREEN}_${RESET}                 ${DIM}├══════╗${RESET}`,
      `${DIM}  ╰────────────────────────────────╯ ┌════╝${RESET}`,
      `${DIM}                                     └══╗${RESET}`,
      `${DIM}                                        ╹${RESET}`,
    ];

    console.log(lines.join("\n"));
  },
  withAgent(id: number): Logger {
    return createLogger(id);
  },
};
