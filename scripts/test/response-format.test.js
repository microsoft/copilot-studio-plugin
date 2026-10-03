const assert = require("node:assert/strict");
const test = require("node:test");

const {
  collectToolCalls,
  summarizeTurn,
  MAX_TOOL_RESULT_CHARS,
} = require("../src/response-format");

// Shape of the informative activities the agenticruntime sends for one flow tool call.
function toolActivity(text, entity) {
  return {
    type: "typing",
    text,
    channelData: { streamType: "informative" },
    entities: [
      {
        type: "toolCall",
        toolCallId: "toolu_01",
        toolName: "GetPurchaseStatus",
        toolDisplayName: "GetPurchaseStatus",
        toolCategory: "Flow",
        toolKind: "tool",
        description: "Looks up a purchase request.",
        ...entity,
      },
    ],
  };
}

const started = toolActivity("Calling GetPurchaseStatus...", {
  status: "started",
  filledParameters: { prNumber: "PR-1042" },
  unfilledParameters: ["ticketId"],
});
const completed = toolActivity("GetPurchaseStatus completed", {
  status: "completed",
  filledParameters: { prNumber: "PR-1042" },
  durationMs: 6302,
  result: '{"status":"approved"}',
});

test("merges started and completed toolCall entities into one record", () => {
  assert.deepEqual(collectToolCalls([started, completed]), [
    {
      id: "toolu_01",
      name: "GetPurchaseStatus",
      category: "Flow",
      status: "completed",
      filledParameters: { prNumber: "PR-1042" },
      unfilledParameters: ["ticketId"],
      durationMs: 6302,
      result: '{"status":"approved"}',
    },
  ]);
});

test("keeps a call that only started", () => {
  const [call] = collectToolCalls([started]);
  assert.equal(call.status, "started");
  assert.equal(call.result, undefined);
});

test("keeps separate calls apart, in call order", () => {
  const other = toolActivity("Calling CheckStock...", {
    toolCallId: "toolu_02",
    toolName: "CheckStock",
    status: "started",
    filledParameters: { partNo: "A-1" },
  });
  const calls = collectToolCalls([started, other, completed]);
  assert.deepEqual(
    calls.map((c) => [c.id, c.name, c.status]),
    [
      ["toolu_01", "GetPurchaseStatus", "completed"],
      ["toolu_02", "CheckStock", "started"],
    ]
  );
});

test("truncates long results and reports the full length", () => {
  const big = toolActivity("GetPurchaseStatus completed", {
    status: "completed",
    result: "x".repeat(5000),
  });
  const [call] = collectToolCalls([big]);
  assert.equal(call.result.length, MAX_TOOL_RESULT_CHARS);
  assert.equal(call.resultTruncated, true);
  assert.equal(call.resultLength, 5000);
});

test("a repeated started entity does not undo completed", () => {
  const [call] = collectToolCalls([started, completed, started]);
  assert.equal(call.status, "completed");
  assert.equal(call.result, '{"status":"approved"}');
});

test("an empty filledParameters object keeps the earlier values", () => {
  const emptyParams = toolActivity("GetPurchaseStatus completed", {
    status: "completed",
    filledParameters: {},
  });
  const [call] = collectToolCalls([started, emptyParams]);
  assert.deepEqual(call.filledParameters, { prNumber: "PR-1042" });
});

test("an empty unfilledParameters list replaces the earlier one", () => {
  const nowFilled = toolActivity("GetPurchaseStatus completed", {
    status: "completed",
    unfilledParameters: [],
  });
  const [call] = collectToolCalls([started, nowFilled]);
  assert.deepEqual(call.unfilledParameters, []);
});

test("null results are left out and object results are stringified", () => {
  const nullResult = toolActivity("GetPurchaseStatus completed", { status: "completed", result: null });
  assert.equal(collectToolCalls([nullResult])[0].result, undefined);
  const objResult = toolActivity("GetPurchaseStatus completed", {
    status: "completed",
    result: { status: "approved" },
  });
  assert.equal(collectToolCalls([objResult])[0].result, '{"status":"approved"}');
});

test("keeps an error field when the runtime sends one", () => {
  const failed = toolActivity("GetPurchaseStatus failed", {
    status: "failed",
    error: { code: "FlowFailed", message: "boom" },
  });
  const [call] = collectToolCalls([started, failed]);
  assert.equal(call.status, "failed");
  assert.deepEqual(call.error, { code: "FlowFailed", message: "boom" });
});

test("keeps calls without a toolCallId as separate records", () => {
  const noId = (status) => ({
    type: "typing",
    entities: [{ type: "toolCall", toolName: "Lookup", status }],
  });
  const calls = collectToolCalls([noId("started"), noId("completed")]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.name === "Lookup"));
});

test("ignores activities without toolCall entities", () => {
  const thought = { type: "typing", entities: [{ type: "thought", text: "thinking" }] };
  assert.deepEqual(collectToolCalls([thought, { type: "message", text: "hi" }]), []);
});

test("summarizeTurn exposes tool_calls next to steps", () => {
  const summary = summarizeTurn({ activities: [started, completed] });
  assert.deepEqual(summary.steps, ["Calling GetPurchaseStatus...", "GetPurchaseStatus completed"]);
  assert.equal(summary.tool_calls.length, 1);
  assert.equal(summary.tool_calls[0].result, '{"status":"approved"}');
});

test("an empty error string is treated as no error", () => {
  const blank = toolActivity("GetPurchaseStatus completed", { status: "completed", error: "" });
  assert.equal(collectToolCalls([blank])[0].error, undefined);
});

test("a status the runtime adds later is not dropped after completed", () => {
  const cancelled = toolActivity("GetPurchaseStatus cancelled", { status: "cancelled" });
  assert.equal(collectToolCalls([started, completed, cancelled])[0].status, "cancelled");
});

test("an anonymous call never merges with a real id that looks like its fallback", () => {
  const anon = { type: "typing", entities: [{ type: "toolCall", toolName: "Lookup", status: "started" }] };
  const real = {
    type: "typing",
    entities: [{ type: "toolCall", toolCallId: "Lookup#0", toolName: "Lookup", status: "completed" }],
  };
  const calls = collectToolCalls([anon, real]);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].id, calls[1].id);
});

test("an empty error does not hide a non-empty errorMessage", () => {
  const both = toolActivity("GetPurchaseStatus failed", {
    status: "failed",
    error: "",
    errorMessage: "Flow run failed",
  });
  assert.equal(collectToolCalls([both])[0].error, "Flow run failed");
});

test("a later short result clears the truncation fields", () => {
  const long = toolActivity("GetPurchaseStatus completed", { status: "completed", result: "x".repeat(5000) });
  const short = toolActivity("GetPurchaseStatus completed", { status: "completed", result: "ok" });
  const [call] = collectToolCalls([long, short]);
  assert.equal(call.result, "ok");
  assert.equal(call.resultTruncated, undefined);
  assert.equal(call.resultLength, undefined);
});

test("a repeated started entity does not revert the parameters", () => {
  const filled = toolActivity("GetPurchaseStatus completed", {
    status: "completed",
    filledParameters: { prNumber: "PR-1042", ticketId: "T-7" },
    unfilledParameters: [],
    result: "ok",
  });
  const [call] = collectToolCalls([started, filled, started]);
  assert.deepEqual(call.filledParameters, { prNumber: "PR-1042", ticketId: "T-7" });
  assert.deepEqual(call.unfilledParameters, []);
});

test("an error is dropped when a later entity moves the call to a new status without one", () => {
  const failed = toolActivity("GetPurchaseStatus failed", { status: "failed", error: "boom" });
  const done = toolActivity("GetPurchaseStatus completed", { status: "completed", result: "ok" });
  assert.equal(collectToolCalls([started, failed, done])[0].error, undefined);
});

test("a non-empty error wins over errorMessage", () => {
  const both = toolActivity("GetPurchaseStatus failed", {
    status: "failed",
    error: "boom",
    errorMessage: "other",
  });
  assert.equal(collectToolCalls([both])[0].error, "boom");
});

test("anonymous calls get an anon: id with the tool name", () => {
  const anon = { type: "typing", entities: [{ type: "toolCall", toolName: "Lookup", status: "started" }] };
  const nameless = { type: "typing", entities: [{ type: "toolCall", status: "started" }] };
  assert.deepEqual(
    collectToolCalls([anon, nameless]).map((c) => c.id),
    ["anon:Lookup#0", "anon:tool#1"]
  );
});
