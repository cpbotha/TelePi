import {
  describeEntry,
  renderBranchConfirmation,
  renderLabels,
  renderTree,
  type SessionTreeNodeLike as SessionTreeNode,
} from "../src/tree.js";

function makeNode(
  overrides: Partial<any> & { type: string; id: string },
  children: SessionTreeNode[] = [],
  label?: string,
): SessionTreeNode {
  return {
    entry: {
      type: overrides.type,
      id: overrides.id,
      parentId: overrides.parentId ?? null,
      timestamp: overrides.timestamp ?? "2025-01-01T00:00:00Z",
      ...overrides,
    },
    children,
    label,
  } as SessionTreeNode;
}

function makeMessageNode(
  id: string,
  role: string,
  content: string | any[],
  parentId: string | null = null,
  children: SessionTreeNode[] = [],
  label?: string,
  messageOverrides: Record<string, unknown> = {},
): SessionTreeNode {
  return makeNode(
    {
      type: "message",
      id,
      parentId,
      message: { role, content, timestamp: Date.now(), ...messageOverrides },
    },
    children,
    label,
  );
}

describe("tree rendering", () => {
  describe("describeEntry", () => {
    it("describes user and assistant messages", () => {
      expect(
        describeEntry({
          type: "message",
          message: { role: "user", content: "Help me refactor this function please" },
        }),
      ).toBe('user: "Help me refactor this function please"');

      expect(
        describeEntry({
          type: "message",
          message: {
            role: "user",
            content: [{ type: "text", text: "First block" }, { type: "text", text: "Second block" }],
          },
        }),
      ).toBe('user: "First block Second block"');

      expect(
        describeEntry({
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "Here is a clean approach" }] },
        }),
      ).toBe('assistant: "Here is a clean approach"');
    });

    it("handles assistant tool calls, tool results, and other entry types", () => {
      expect(
        describeEntry({
          type: "message",
          message: { role: "assistant", content: [{ type: "toolCall", name: "read" }] },
        }),
      ).toBe("assistant: [tool read]");

      expect(
        describeEntry({
          type: "message",
          message: { role: "toolResult", toolName: "bash", content: [] },
        }),
      ).toBe("toolResult: bash");

      expect(describeEntry({ type: "compaction" })).toBe("[compaction]");
      expect(describeEntry({ type: "branch_summary" })).toBe("[branch summary]");
      expect(
        describeEntry({ type: "model_change", provider: "anthropic", modelId: "claude-sonnet-4-5" }),
      ).toBe("[model anthropic/claude-sonnet-4-5]");
      expect(describeEntry({ type: "unknownType" })).toBe("[unknownType]");
      expect(describeEntry({ type: "context_edit", replacement: [{ type: "text", text: "patched" }] })).toBe("[context edit]");
      expect(describeEntry({ type: "context_edit", replacement: null })).toBe("[context edit: omitted]");
    });
  });

  describe("renderTree", () => {
    it("returns an empty message for an empty tree", () => {
      const result = renderTree([], null);

      expect(result).toEqual({
        text: "Session tree is empty.",
        buttons: [],
        totalEntries: 0,
        shownEntries: 0,
        page: 0,
        totalPages: 0,
      });
    });

    it("returns a filtered empty result with no pages", () => {
      const tree = [makeNode({ type: "compaction", id: "comp0001" })];

      const result = renderTree(tree, null, { mode: "user-only" });

      expect(result.text).toContain("No matching entries.");
      expect(result.totalEntries).toBe(0);
      expect(result.shownEntries).toBe(0);
      expect(result.page).toBe(0);
      expect(result.totalPages).toBe(0);
    });

    it("renders a linear tree with filter buttons only", () => {
      const tree = [
        makeMessageNode(
          "aaaa1111",
          "user",
          "Start here",
          null,
          [makeMessageNode("bbbb2222", "assistant", "Sure", "aaaa1111", [makeMessageNode("cccc3333", "user", "Next", "bbbb2222")])],
        ),
      ];

      const result = renderTree(tree, "cccc3333");

      expect(result.text).toContain("<pre>");
      expect(result.text).toContain("aaaa user: \"Start here\"");
      expect(result.text).toContain("└─ bbbb assistant");
      expect(result.text).toContain("← active");
      expect(result.text).toContain("Page 1/1");
      expect(result.buttons.map((button) => button.callbackData)).toEqual(["tree_mode_all", "tree_mode_user"]);
    });

    it("renders branch buttons, labels, pagination notes, and active markers", () => {
      const tree = [
        makeMessageNode(
          "root0001",
          "user",
          "Start",
          null,
          [
            makeMessageNode(
              "asst0002",
              "assistant",
              "Choose a path",
              "root0001",
              [
                makeMessageNode("usr00003", "user", "Path A", "asst0002"),
                makeMessageNode("usr00004", "user", "Path B", "asst0002", [], "checkpoint"),
              ],
            ),
          ],
        ),
      ];

      const result = renderTree(tree, "usr00003");
      const callbackData = result.buttons.map((button) => button.callbackData);

      expect(result.text).toContain("├─ usr0 user: \"Path A\" ← active");
      expect(result.text).toContain("└─ usr0 user: \"Path B\" [checkpoint]");
      expect(result.text).toContain("└─ asst assistant: \"Choose a path\"");
      expect(result.text).toContain("Current branch context.");
      expect(callbackData).toContain("tree_nav_asst0002");
      expect(callbackData).toContain("tree_nav_usr00004");
    });

    it("opens the default view on the page containing the active branch", () => {
      const tree = [
        makeMessageNode(
          "root0000",
          "user",
          "Root",
          null,
          [
            makeMessageNode("node0001", "user", "Active branch", "root0000"),
            makeMessageNode("node0002", "user", "Later branch 2", "root0000"),
            makeMessageNode("node0003", "user", "Later branch 3", "root0000"),
            makeMessageNode("node0004", "user", "Later branch 4", "root0000"),
            makeMessageNode("node0005", "user", "Later branch 5", "root0000"),
            makeMessageNode("node0006", "user", "Later branch 6", "root0000"),
            makeMessageNode("node0007", "user", "Later branch 7", "root0000"),
          ],
        ),
      ];

      const result = renderTree(tree, "node0001");

      expect(result.page).toBe(0);
      expect(result.totalPages).toBe(2);
      expect(result.text).toContain("node user: \"Active branch\" ← active");
      expect(result.text).not.toContain("Later branch 7");
      expect(result.buttons.map((button) => button.callbackData)).toContain("tree_page_1");
    });

    it("shows the active branch page hint when viewing another page", () => {
      const tree = [
        makeMessageNode(
          "root0000",
          "user",
          "Root",
          null,
          [
            makeMessageNode("node0001", "user", "Earlier branch 1", "root0000"),
            makeMessageNode("node0002", "user", "Earlier branch 2", "root0000"),
            makeMessageNode("node0003", "user", "Earlier branch 3", "root0000"),
            makeMessageNode("node0004", "user", "Earlier branch 4", "root0000"),
            makeMessageNode("node0005", "user", "Earlier branch 5", "root0000"),
            makeMessageNode("node0006", "user", "Earlier branch 6", "root0000"),
            makeMessageNode("node0007", "user", "Active branch", "root0000"),
          ],
        ),
      ];

      const result = renderTree(tree, "node0007", { page: 0 });

      expect(result.page).toBe(0);
      expect(result.totalPages).toBe(2);
      expect(result.text).toContain("Current branch page: 2/2.");
      expect(result.text).not.toContain("Current branch context.");
      expect(result.text).not.toContain("Active branch");
    });

    it("keeps user-only mode focused on the nearest visible ancestor", () => {
      const tree = [
        makeMessageNode(
          "root0001",
          "user",
          "Root",
          null,
          [
            makeMessageNode("asst0002", "assistant", "Assistant reply", "root0001", [
              makeMessageNode("user0003", "user", "Latest user turn", "asst0002", [
                makeMessageNode("asst0004", "assistant", "Active assistant leaf", "user0003"),
              ]),
            ]),
          ],
        ),
      ];

      const result = renderTree(tree, "asst0004", { mode: "user-only", limit: 1 });

      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(2);
      expect(result.text).toContain("Page 2/2");
      expect(result.text).toContain('user user: "Latest user turn"');
      expect(result.text).not.toContain("Root");
      expect(result.buttons.map((button) => button.callbackData)).toContain("tree_page_0");
    });

    it("compresses deep indentation so later pages still show a readable tree", () => {
      let current = makeMessageNode("n0000000", "user", "root");
      const tree = [current];

      for (let index = 1; index < 18; index += 1) {
        const child = makeMessageNode(
          `n${String(index).padStart(7, "0")}`,
          index % 2 === 0 ? "assistant" : "user",
          `deep node ${index}`,
          current.entry.id,
        );
        current.children.push(child);
        current = child;
      }

      const result = renderTree(tree, current.entry.id);

      expect(result.text).toContain("Page 2/2");
      expect(result.text).toContain("… n000");
      expect(result.text).toContain("← active");
      expect(result.text).not.toContain("<pre>                                                                                                                                ");
    });

    it("falls back to nearby actionable buttons when the active page has none", () => {
      const branchPoint = makeMessageNode(
        "branch001",
        "assistant",
        "Choose a path",
        "root0001",
        [
          makeMessageNode("leaf00001", "user", "Short branch", "branch001"),
          makeMessageNode("deep00001", "user", "Continue deep branch", "branch001"),
        ],
      );

      let current = branchPoint.children[1]!;
      for (let index = 2; index <= 12; index += 1) {
        const next = makeMessageNode(
          `deep${String(index).padStart(5, "0")}`,
          index % 2 === 0 ? "assistant" : "user",
          `Deep branch node ${index}`,
          current.entry.id,
        );
        current.children.push(next);
        current = next;
      }

      const tree = [
        makeMessageNode("root0001", "user", "Root", null, [branchPoint]),
      ];

      const result = renderTree(tree, current.entry.id);
      const callbackData = result.buttons.map((button) => button.callbackData);

      expect(result.text).toContain("Page 2/2");
      expect(result.text).toContain("← active");
      expect(callbackData).toContain("tree_nav_branch001");
      expect(callbackData).toContain("tree_nav_leaf00001");
      expect(callbackData).toContain("tree_mode_all");
      expect(callbackData).toContain("tree_mode_user");
    });

    it("supports pagination, user-only mode, and all-with-buttons mode", () => {
      const tree = [
        makeMessageNode(
          "u0000001",
          "user",
          "one",
          null,
          [
            makeMessageNode("a0000002", "assistant", "two", "u0000001", [
              makeMessageNode("u0000003", "user", "three", "a0000002", [
                makeNode({ type: "compaction", id: "c0000004", parentId: "u0000003", tokensBefore: 12345, summary: "Short" }, [
                  makeMessageNode("u0000005", "user", "four", "c0000004", [
                    makeMessageNode("a0000006", "assistant", "five", "u0000005", [
                      makeMessageNode("u0000007", "user", "six", "a0000006"),
                    ]),
                  ]),
                ]),
              ]),
            ]),
          ],
        ),
      ];

      const paged = renderTree(tree, "u0000007", { limit: 3, page: 1 });
      expect(paged.totalEntries).toBe(7);
      expect(paged.shownEntries).toBe(3);
      expect(paged.page).toBe(1);
      expect(paged.totalPages).toBe(3);
      expect(paged.text).toContain("Page 2/3 · entries 4-6 of 7.");
      expect(paged.buttons.map((button) => button.callbackData)).toContain("tree_page_0");
      expect(paged.buttons.map((button) => button.callbackData)).toContain("tree_page_2");

      const userOnly = renderTree(tree, "u0000007", { mode: "user-only", limit: 10 });
      expect(userOnly.text).toContain("Filter: user messages only.");
      expect(userOnly.text).toContain('user: "one"');
      expect(userOnly.text).not.toContain('assistant: "two"');
      expect(userOnly.buttons.some((button) => button.callbackData === "tree_nav_u0000001")).toBe(true);

      const allMode = renderTree(tree, "u0000007", { mode: "all-with-buttons", limit: 10, page: 1 });
      expect(allMode.text).toContain("Filter: all entries with navigation buttons.");
      expect(allMode.text).toContain("Page 2/2");
      expect(allMode.buttons.some((button) => button.callbackData === "tree_nav_u0000007")).toBe(true);
      expect(allMode.buttons.some((button) => button.callbackData === "tree_page_0")).toBe(true);
    });

    it("keeps oversized trees within Telegram's message limit", () => {
      const longText = "x".repeat(300);
      let current = makeMessageNode("root0000", "user", longText);
      const tree = [current];

      for (let index = 1; index < 50; index += 1) {
        const child = makeMessageNode(
          `node${String(index).padStart(4, "0")}`,
          index % 2 === 0 ? "assistant" : "user",
          longText,
          current.entry.id,
        );
        current.children.push(child);
        current = child;
      }

      const result = renderTree(tree, current.entry.id, { limit: 50 });

      expect(result.text.length).toBeLessThanOrEqual(3900);
      expect(result.text).toContain("Page 1/1");
    });

    it("renders a realistic complex tree", () => {
      const tree = [
        makeMessageNode(
          "1111aaaa",
          "user",
          "Investigate production latency spike",
          null,
          [
            makeMessageNode(
              "2222bbbb",
              "assistant",
              "I'll inspect the logs and recent deploys",
              "1111aaaa",
              [
                makeNode({ type: "model_change", id: "3333cccc", parentId: "2222bbbb", provider: "anthropic", modelId: "claude-sonnet-4-5" }, [
                  makeMessageNode("4444dddd", "user", "Focus on API timeouts first", "3333cccc", [], "api-timeouts"),
                  makeNode({ type: "branch_summary", id: "5555eeee", parentId: "3333cccc", fromId: "4444dddd", summary: "Abandoned infra angle" }, [
                    makeMessageNode("6666ffff", "user", "Now check database saturation", "5555eeee"),
                  ]),
                ]),
              ],
            ),
          ],
        ),
      ];

      const result = renderTree(tree, "6666ffff", { mode: "all-with-buttons" });

      expect(result.text).toContain('1111 user: "Investigate production latency spike"');
      expect(result.text).toContain("[model anthropic/claude-sonnet-4-5]");
      expect(result.text).toContain("[branch summary]");
      expect(result.text).toContain("[api-timeouts]");
      expect(result.text).toContain("← active");
      expect(result.buttons.some((button) => button.callbackData === "tree_nav_5555eeee")).toBe(true);
    });
  });

  describe("renderBranchConfirmation", () => {
    it("shows entry details, children, labels, and action buttons", () => {
      const result = renderBranchConfirmation(
        { type: "message", id: "aaaa1111", message: { role: "user", content: "Branch from here" } },
        [
          { type: "message", id: "bbbb2222", message: { role: "assistant", content: "Active child" } },
          { type: "message", id: "cccc3333", message: { role: "user", content: "Named child" } },
        ],
        "bbbb2222",
        new Map([["cccc3333", "saved"]]),
      );

      expect(result.text).toContain("Navigate to this point?");
      expect(result.text).toContain("Branch from here");
      expect(result.text).toContain("Children");
      expect(result.text).toContain("← active");
      expect(result.text).toContain("[saved]");
      expect(result.buttons).toEqual([
        { label: "🔀 Navigate here", callbackData: "tree_go_aaaa1111" },
        { label: "📝 Navigate + Summarize", callbackData: "tree_sum_aaaa1111" },
        { label: "❌ Cancel", callbackData: "tree_cancel" },
      ]);
    });
  });

  describe("renderLabels", () => {
    it("returns a fallback when there are no labels", () => {
      expect(renderLabels([makeMessageNode("aaaa1111", "user", "No labels yet")])).toBe("No labels set.");
    });

    it("renders multiple labels", () => {
      const tree = [
        makeMessageNode(
          "aaaa1111",
          "user",
          "Start",
          null,
          [
            makeMessageNode("bbbb2222", "assistant", "Middle", "aaaa1111", [makeMessageNode("cccc3333", "user", "End", "bbbb2222", [], "done")], "checkpoint"),
          ],
        ),
      ];

      const rendered = renderLabels(tree);
      expect(rendered).toContain("🏷️ <code>bbbb</code> <b>[checkpoint]</b>");
      expect(rendered).toContain("🏷️ <code>cccc</code> <b>[done]</b>");
      expect(rendered).toContain("assistant");
      expect(rendered).toContain("user");
    });
  });
});
