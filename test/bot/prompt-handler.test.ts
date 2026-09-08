import { createPromptHandler } from "../../src/bot/prompt-handler.js";

type PromptSubscribers = {
  onTextDelta: (delta: string) => void;
  onToolStart: (toolName: string, toolCallId: string) => void;
  onToolUpdate: (toolCallId: string, partialResult: string) => void;
  onToolEnd: (toolCallId: string, isError: boolean) => void;
  onAgentEnd: () => void;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function setupPromptHandler(overrides: { editDebounceMs?: number } = {}) {
  const subscribers: PromptSubscribers[] = [];

  const piSession = {
    bindExtensions: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((handlers: PromptSubscribers) => {
      subscribers.push(handlers);
      return () => {
        const index = subscribers.indexOf(handlers);
        if (index >= 0) {
          subscribers.splice(index, 1);
        }
      };
    }),
    prompt: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn(() => ({ agent: { waitForIdle: vi.fn().mockResolvedValue(undefined) } })),
    newSession: vi.fn(),
    fork: vi.fn(),
    navigateTree: vi.fn(),
    switchSession: vi.fn(),
    reload: vi.fn(),
  };

  const api = {
    sendRichMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 43 }),
    editMessageText: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    sendChatAction: vi.fn().mockResolvedValue(true),
  };

  let taskPromise: Promise<void> | undefined;

  const handler = createPromptHandler({
    bot: { api } as any,
    toolVerbosity: "summary",
    editDebounceMs: overrides.editDebounceMs ?? 0,
    typingIntervalMs: 60_000,
    isBusy: () => false,
    taskRunner: {
      tryStartPrompt: (_target, _promptText, task) => {
        taskPromise = task();
        return "started";
      },
    },
    ensureActiveSession: async () => piSession as any,
    syncChatScopedCommands: vi.fn().mockResolvedValue(undefined),
    refreshChatScopedCommands: vi.fn().mockResolvedValue(undefined),
    extensionDialogs: {
      openSelect: vi.fn(),
      openConfirm: vi.fn(),
      openInput: vi.fn(),
    } as any,
    sendBusyReply: vi.fn().mockResolvedValue(undefined),
  });

  return {
    handler,
    api,
    piSession,
    subscribers,
    runTask: async () => {
      await taskPromise;
      // The final message is delivered from the onAgentEnd callback, so give its
      // microtask chain a moment to settle after the prompt task itself resolves.
      await sleep(20);
    },
  };
}

describe("bot prompt handler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("waits for an in-flight draft edit before delivering the final message", async () => {
    const { handler, api, piSession, subscribers, runTask } = setupPromptHandler();
    const events: string[] = [];
    let releaseDraft: (() => void) | undefined;
    const draftGate = new Promise<void>((resolve) => {
      releaseDraft = resolve;
    });

    api.editMessageText.mockImplementation(
      async (_chatId: unknown, _messageId: unknown, _text: unknown, options: any) => {
        if (options?.reply_markup) {
          events.push("draft:start");
          await draftGate;
          events.push("draft:end");
          return true;
        }
        events.push("final");
        return true;
      },
    );

    piSession.prompt.mockImplementation(async () => {
      const handlers = subscribers[0]!;
      handlers.onTextDelta("Hello");
      // Let the first message go out so the next delta actually changes the body.
      await sleep(5);
      handlers.onTextDelta(" there");
      // Let the debounced draft edit reach Telegram and block there.
      await sleep(20);
      handlers.onTextDelta(" world");
      handlers.onAgentEnd();
    });

    await handler({} as any, { chatId: 123 }, "hi");
    await sleep(60);

    expect(events).toEqual(["draft:start"]);

    releaseDraft!();
    await runTask();

    expect(events).toEqual(["draft:start", "draft:end", "final"]);
  });

  it("tolerates a draft edit that Telegram canceled for the final edit", async () => {
    const { handler, api, piSession, subscribers, runTask } = setupPromptHandler();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    api.editMessageText.mockImplementation(
      async (_chatId: unknown, _messageId: unknown, _text: unknown, options: any) => {
        if (options?.reply_markup) {
          throw new Error("Bad Request: canceled by new edit message request");
        }
        return true;
      },
    );

    piSession.prompt.mockImplementation(async () => {
      const handlers = subscribers[0]!;
      handlers.onTextDelta("Hello");
      await sleep(5);
      handlers.onTextDelta(" there");
      await sleep(20);
      handlers.onTextDelta(" world");
      handlers.onAgentEnd();
    });

    await handler({} as any, { chatId: 123 }, "hi");
    await runTask();

    expect(consoleError).not.toHaveBeenCalled();
    expect(api.editMessageText.mock.calls.some((call) => call[3]?.reply_markup !== undefined)).toBe(true);
    expect(api.editMessageText.mock.calls.some((call) => call[3]?.reply_markup === undefined)).toBe(true);
  });
});
