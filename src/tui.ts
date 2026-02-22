import {
  createCliRenderer,
  Box,
  Text,
  TextAttributes,
  t,
  bold,
  dim,
  fg,
  ScrollBoxRenderable,
  BoxRenderable,
  TextRenderable,
  Renderable,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";

// Tokyo Night Dark palette
const TN_BG = "#1a1b26";
const TN_BG_DARK = "#16161e";
const TN_BG_HIGHLIGHT = "#292e42";
const TN_FG_DARK = "#565f89";
const TN_CYAN = "#7dcfff";
const TN_GREEN = "#9ece6a";
const TN_YELLOW = "#e0af68";
const TN_RED = "#f7768e";
const TN_BLUE = "#7aa2f7";
const TN_MAGENTA = "#bb9af7";
const TN_ORANGE = "#ff9e64";

const SPINNER_FRAMES = [
  "\u28CB",
  "\u28D9",
  "\u28F9",
  "\u28F8",
  "\u28FC",
  "\u28F4",
  "\u28E6",
  "\u28E7",
  "\u28C7",
  "\u28CF",
];

type ExecutionStatus =
  | "running"
  | "success"
  | "error"
  | "cancelled"
  | "timeout";

interface ExecutionCard {
  id: string;
  commandName: string;
  agentId: number;
  startedAt: Date;
  status: ExecutionStatus;
  cardBox: BoxRenderable;
  statusText: TextRenderable;
  statusBadge: BoxRenderable;
}

interface ProjectPanel {
  projectKey: string;
  label: string;
  scrollBox: ScrollBoxRenderable;
  cards: Map<string, ExecutionCard>;
  runningCount: number;
  emptyText: BoxRenderable;
}

export interface TuiManager {
  addProject(projectKey: string, label: string): void;
  removeProject(projectKey: string): void;
  addExecution(
    id: string,
    commandName: string,
    agentId: number,
    projectKey: string,
  ): void;
  updateExecution(id: string, status: ExecutionStatus): void;
  logMessage(
    level: "info" | "success" | "warn" | "error",
    event: string,
    message: string,
  ): void;
  setPort(port: number): void;
  destroy(): void;
}

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function getStatusStyle(
  status: ExecutionStatus,
  frame: string,
): { color: string; label: string; symbol: string } {
  switch (status) {
    case "running":
      return { color: TN_YELLOW, label: "running", symbol: frame };
    case "success":
      return { color: TN_GREEN, label: "success", symbol: "\u2713" };
    case "error":
      return { color: TN_RED, label: "error", symbol: "\u2717" };
    case "cancelled":
      return { color: TN_ORANGE, label: "cancelled", symbol: "\u25CB" };
    case "timeout":
      return { color: TN_ORANGE, label: "timeout", symbol: "\u25F4" };
  }
}

interface TabOption {
  name: string;
  value?: string;
}

type TabSelectionCallback = (index: number, option: TabOption) => void;

class PillTabBar {
  private renderer: CliRenderer;
  private container: BoxRenderable;
  private options: TabOption[] = [];
  private selectedIndex = -1;
  private wrapSelection: boolean;
  private selectionCallback: TabSelectionCallback | null = null;
  private tabElements: Renderable[] = [];
  private keyListener: ((key: KeyEvent) => void) | null = null;

  constructor(renderer: CliRenderer, opts: { wrapSelection?: boolean }) {
    this.renderer = renderer;
    this.wrapSelection = opts.wrapSelection ?? true;

    this.container = new BoxRenderable(renderer, {
      id: "project-tabs",
      flexDirection: "row",
      width: "100%",
      flexShrink: 0,
      gap: 1,
      alignItems: "center",
      paddingLeft: 1,
      paddingRight: 1,
    });
    this.container.visible = false;

    // Global key listener — this is the only interactive element in the TUI
    this.keyListener = (key: KeyEvent): void => this.handleKey(key);
    renderer.keyInput.on("keypress", this.keyListener);
  }

  private handleKey(key: KeyEvent): void {
    if (!this.container.visible || this.options.length === 0) return;
    if (key.name === "left" || key.name === "[") {
      this.moveSelection(-1);
    } else if (key.name === "right" || key.name === "]") {
      this.moveSelection(1);
    }
  }

  private moveSelection(delta: number): void {
    if (this.options.length === 0) return;
    let newIndex = this.selectedIndex + delta;
    if (this.wrapSelection) {
      newIndex =
        ((newIndex % this.options.length) + this.options.length) %
        this.options.length;
    } else {
      newIndex = Math.max(0, Math.min(this.options.length - 1, newIndex));
    }
    this.selectIndex(newIndex);
  }

  private selectIndex(index: number): void {
    if (index === this.selectedIndex) return;
    this.selectedIndex = index;
    this.rebuild();
    this.selectionCallback?.(index, this.options[index]!);
  }

  private rebuild(): void {
    for (const el of this.tabElements) {
      this.container.remove(el.id);
      el.destroy();
    }
    this.tabElements = [];

    for (let i = 0; i < this.options.length; i++) {
      const option = this.options[i]!;
      const isSelected = i === this.selectedIndex;

      if (isSelected) {
        // Solid background block, no border
        const text = new TextRenderable(this.renderer, {
          id: `tab-text-${i}`,
          content: t` ${bold(fg(TN_BG)(option.name))} `,
          selectable: false,
        });
        const pill = new BoxRenderable(this.renderer, {
          id: `tab-pill-${i}`,
          backgroundColor: TN_CYAN,
          paddingLeft: 1,
          paddingRight: 1,
          onMouseDown: () => this.selectIndex(i),
        });
        pill.add(text);
        this.container.add(pill);
        this.tabElements.push(pill);
      } else {
        // Plain text label with padding
        const label = new TextRenderable(this.renderer, {
          id: `tab-label-${i}`,
          content: t` ${fg(TN_FG_DARK)(option.name)} `,
          selectable: false,
          onMouseDown: () => this.selectIndex(i),
        });
        this.container.add(label);
        this.tabElements.push(label);
      }
    }
  }

  get visible(): boolean {
    return this.container.visible;
  }

  set visible(value: boolean) {
    this.container.visible = value;
  }

  get renderable(): BoxRenderable {
    return this.container;
  }

  setOptions(options: TabOption[]): void {
    this.options = options;
    if (this.selectedIndex >= options.length) {
      this.selectedIndex = Math.max(0, options.length - 1);
    }
    this.rebuild();
  }

  getSelectedOption(): TabOption | null {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.options.length) {
      return null;
    }
    return this.options[this.selectedIndex]!;
  }

  setSelectedIndex(index: number): void {
    if (index < 0 || index >= this.options.length) return;
    if (index === this.selectedIndex) return;
    this.selectedIndex = index;
    this.rebuild();
    this.selectionCallback?.(index, this.options[index]!);
  }

  onChanged(callback: TabSelectionCallback): void {
    this.selectionCallback = callback;
  }

  destroy(): void {
    if (this.keyListener) {
      this.renderer.keyInput.off("keypress", this.keyListener);
      this.keyListener = null;
    }
    for (const el of this.tabElements) {
      el.destroy();
    }
    this.tabElements = [];
    this.container.destroy();
  }
}

export async function createTui(version: string): Promise<TuiManager> {
  const renderer: CliRenderer = await createCliRenderer({
    exitOnCtrlC: true,
    useMouse: true,
    targetFps: 30,
    onDestroy: () => {
      process.exit();
    },
  });

  // Per-project panels and lookup maps
  const panels = new Map<string, ProjectPanel>();
  const cardToProject = new Map<string, string>();
  let totalRunningCount = 0;
  let spinnerIndex = 0;
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;

  // -- Toolbar --
  const toolbar = Box(
    {
      flexDirection: "row",
      width: "100%",
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: TN_BG_DARK,
      borderStyle: "rounded",
      borderColor: TN_BG_HIGHLIGHT,
      paddingLeft: 2,
      paddingRight: 2,
    },
    Box(
      { flexDirection: "row", gap: 0 },
      Text({
        content: "@fcannizzaro/",
        fg: TN_FG_DARK,
      }),
      Text({
        content: "exocommand",
        fg: TN_CYAN,
        attributes: TextAttributes.BOLD,
      }),
    ),
    Text({
      content: `v${version}`,
      fg: TN_FG_DARK,
      attributes: TextAttributes.DIM,
    }),
  );

  // -- PillTabBar for project switching --
  const tabBar = new PillTabBar(renderer, { wrapSelection: true });

  // Show the correct panel when the user navigates tabs
  tabBar.onChanged((_index: number, option: TabOption) => {
    for (const [key, panel] of panels) {
      panel.scrollBox.visible = option.value === key;
    }
  });

  // -- Panel container (holds per-project ScrollBoxes) --
  const panelContainer = new BoxRenderable(renderer, {
    id: "panel-container",
    flexGrow: 1,
    width: "100%",
    flexDirection: "column",
  });

  // -- Status bar --
  const statusMessage = new TextRenderable(renderer, {
    id: "status-message",
    content: "",
    fg: TN_FG_DARK,
  });

  const statusPort = new TextRenderable(renderer, {
    id: "status-port",
    content: "",
    fg: TN_FG_DARK,
  });

  const statusBar = Box(
    {
      width: "100%",
      height: 3,
      backgroundColor: TN_BG_DARK,
      borderStyle: "rounded",
      borderColor: TN_BG_HIGHLIGHT,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingLeft: 1,
      paddingRight: 1,
    },
    statusMessage,
    statusPort,
  );

  // -- Assemble tree --
  renderer.root.add(
    Box(
      {
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: TN_BG,
      },
      toolbar,
      tabBar.renderable,
      panelContainer,
      statusBar,
    ),
  );

  // -- Tab options helper --
  function rebuildTabOptions(): void {
    const options = [...panels.values()].map((p) => ({
      name: p.label,
      value: p.projectKey,
    }));
    tabBar.setOptions(options);
  }

  // -- Show the panel for the currently selected tab --
  function syncPanelVisibility(): void {
    const selected = tabBar.getSelectedOption();
    for (const [key, panel] of panels) {
      panel.scrollBox.visible = selected?.value === key;
    }
  }

  // -- Spinner control --
  function startSpinner(): void {
    if (spinnerTimer) return;
    renderer.requestLive();
    spinnerTimer = setInterval(() => {
      spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
      const frame = SPINNER_FRAMES[spinnerIndex]!;
      for (const panel of panels.values()) {
        for (const card of panel.cards.values()) {
          if (card.status === "running") {
            card.statusText.content = t`${fg(TN_YELLOW)(`${frame} running`)}`;
          }
        }
      }
    }, 80);
  }

  function stopSpinner(): void {
    if (!spinnerTimer) return;
    clearInterval(spinnerTimer);
    spinnerTimer = null;
    renderer.dropLive();
  }

  // -- Card factory --
  function createCard(
    id: string,
    commandName: string,
    agentId: number,
    startedAt: Date,
  ): ExecutionCard {
    const statusText = new TextRenderable(renderer, {
      id: `status-text-${id}`,
      content: t`${fg(TN_YELLOW)(`${SPINNER_FRAMES[0]} running`)}`,
    });

    const statusBadge = new BoxRenderable(renderer, {
      id: `status-badge-${id}`,
      borderStyle: "rounded",
      borderColor: TN_YELLOW,
      paddingLeft: 1,
      paddingRight: 1,
      height: 3,
    });
    statusBadge.add(statusText);

    const cardBox = new BoxRenderable(renderer, {
      id: `card-${id}`,
      borderStyle: "rounded",
      borderColor: TN_FG_DARK,
      flexDirection: "row",
      gap: 1,
      width: "100%",
      paddingLeft: 1,
      paddingRight: 1,
      title: ` ${formatTime(startedAt)} `,
      titleAlignment: "left",
    });

    // cmd badge
    const cmdBadge = Box(
      {
        borderStyle: "rounded",
        borderColor: TN_FG_DARK,
        paddingLeft: 1,
        paddingRight: 1,
        height: 3,
      },
      Text({ content: t`${dim("cmd")} ${fg(TN_MAGENTA)(commandName)}` }),
    );

    // agent badge
    const agentBadge = Box(
      {
        borderStyle: "rounded",
        borderColor: TN_FG_DARK,
        paddingLeft: 1,
        paddingRight: 1,
        height: 3,
      },
      Text({ content: t`${dim("agent")} ${fg(TN_CYAN)(String(agentId))}` }),
    );

    cardBox.add(agentBadge);
    cardBox.add(cmdBadge);
    cardBox.add(Box({ flexGrow: 1 }));
    cardBox.add(statusBadge);

    return {
      id,
      commandName,
      agentId,
      startedAt,
      status: "running",
      cardBox,
      statusText,
      statusBadge,
    };
  }

  // -- TuiManager implementation --
  return {
    addProject(projectKey: string, label: string): void {
      if (panels.has(projectKey)) return;

      const scrollBox = new ScrollBoxRenderable(renderer, {
        id: `executions-${projectKey}`,
        flexGrow: 1,
        width: "100%",
        stickyScroll: true,
        stickyStart: "bottom",
        viewportCulling: true,
        contentOptions: {
          flexDirection: "column",
          gap: 0,
          padding: 1,
        },
        scrollbarOptions: {
          trackOptions: {
            foregroundColor: TN_BLUE,
            backgroundColor: TN_BG_HIGHLIGHT,
          },
        },
      });

      const emptyText = new BoxRenderable(renderer, {
        id: `empty-${projectKey}`,
        flexGrow: 1,
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
      });
      emptyText.add(
        new TextRenderable(renderer, {
          id: `empty-text-${projectKey}`,
          content: t`${dim("No commands executed yet")}`,
        }),
      );
      scrollBox.add(emptyText);

      scrollBox.visible = false;
      panelContainer.add(scrollBox);

      panels.set(projectKey, {
        projectKey,
        label,
        scrollBox,
        cards: new Map(),
        runningCount: 0,
        emptyText,
      });

      rebuildTabOptions();

      // First project: show tabs and select it
      if (panels.size === 1) {
        tabBar.visible = true;
        tabBar.setSelectedIndex(0);
        scrollBox.visible = true;
      }
    },

    removeProject(projectKey: string): void {
      const panel = panels.get(projectKey);
      if (!panel) return;

      const selected = tabBar.getSelectedOption();
      const wasSelected = selected?.value === projectKey;

      // Remove scroll box from container
      panelContainer.remove(panel.scrollBox.id);

      // Clean up card-to-project mappings
      for (const cardId of panel.cards.keys()) {
        cardToProject.delete(cardId);
      }
      totalRunningCount -= panel.runningCount;

      panels.delete(projectKey);

      if (panels.size === 0) {
        tabBar.visible = false;
        if (totalRunningCount <= 0) {
          totalRunningCount = 0;
          stopSpinner();
        }
      } else {
        rebuildTabOptions();
        if (wasSelected) {
          tabBar.setSelectedIndex(0);
          syncPanelVisibility();
        }
      }
    },

    addExecution(
      id: string,
      commandName: string,
      agentId: number,
      projectKey: string,
    ): void {
      const panel = panels.get(projectKey);
      if (!panel) return;

      // Hide empty state placeholder on first execution
      if (panel.cards.size === 0) {
        panel.emptyText.visible = false;
      }

      const startedAt = new Date();
      const card = createCard(id, commandName, agentId, startedAt);
      panel.cards.set(id, card);
      cardToProject.set(id, projectKey);
      panel.scrollBox.add(card.cardBox);
      panel.runningCount++;
      totalRunningCount++;
      startSpinner();
    },

    updateExecution(id: string, status: ExecutionStatus): void {
      const projectKey = cardToProject.get(id);
      if (!projectKey) return;
      const panel = panels.get(projectKey);
      if (!panel) return;
      const card = panel.cards.get(id);
      if (!card) return;
      if (card.status !== "running") return; // already in terminal state

      card.status = status;
      const style = getStatusStyle(status, SPINNER_FRAMES[spinnerIndex]!);
      card.statusText.content = t`${fg(style.color)(`${style.symbol} ${style.label}`)}`;
      card.statusBadge.borderColor = style.color;

      // update running count for terminal states
      if (status !== "running") {
        panel.runningCount--;
        totalRunningCount--;
        if (totalRunningCount <= 0) {
          totalRunningCount = 0;
          stopSpinner();
        }
      }
    },

    logMessage(
      level: "info" | "success" | "warn" | "error",
      event: string,
      message: string,
    ): void {
      const colorMap: Record<string, string> = {
        info: TN_CYAN,
        success: TN_GREEN,
        warn: TN_YELLOW,
        error: TN_RED,
      };
      const color = colorMap[level] ?? TN_CYAN;
      const ts = formatTime(new Date());
      statusMessage.content = t`${dim(ts)} ${bold(fg(color)(`[${event}]`))} ${message}`;
    },

    setPort(port: number): void {
      statusPort.content = t`${fg(TN_FG_DARK)(`:${port}`)}`;
    },

    destroy(): void {
      stopSpinner();
      tabBar.destroy();
      renderer.destroy();
    },
  };
}
