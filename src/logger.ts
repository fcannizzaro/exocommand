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

export interface RootLogger extends Logger {
  withAgent(id: number): Logger;
}

export const logger: RootLogger = {
  ...createLogger(),
  withAgent(id: number): Logger {
    return createLogger(id);
  },
};

// TUI-aware logger that delegates to TuiManager instead of console
export function createTuiLogger(tui: import("./tui.js").TuiManager): RootLogger {
  function makeLogger(agentId?: number): Logger {
    return {
      info(event: string, message: string): void {
        const msg = agentId !== undefined ? `[agent ${agentId}] ${message}` : message;
        tui.logMessage("info", event, msg);
      },
      success(event: string, message: string): void {
        const msg = agentId !== undefined ? `[agent ${agentId}] ${message}` : message;
        tui.logMessage("success", event, msg);
      },
      warn(event: string, message: string): void {
        const msg = agentId !== undefined ? `[agent ${agentId}] ${message}` : message;
        tui.logMessage("warn", event, msg);
      },
      error(event: string, message: string): void {
        const msg = agentId !== undefined ? `[agent ${agentId}] ${message}` : message;
        tui.logMessage("error", event, msg);
      },
    };
  }

  return {
    ...makeLogger(),
    withAgent(id: number): Logger {
      return makeLogger(id);
    },
  };
}
