/**
 * response-format.js — turn the raw agenticruntime activity stream into a compact,
 * high-signal summary the coding agent (or a human terminal) can consume.
 *
 * The /3p stream is verbose: ~25 cumulative `typing` deltas per turn, plus large
 * inline base64 data-URL attachments. This module distills a turn into:
 *   - greeting   : the start-conversation greeting (start turns only)
 *   - reasoning  : the agent's chain-of-thought steps (entities[].type === "thought")
 *   - steps      : tool/status cues (channelData.streamType === "informative")
 *   - tool_calls : one record per tool call (entities[].type === "toolCall"), with the
 *                  parameters the model filled in, the result, status and duration
 *   - text       : the final answer markdown (the terminal `message` / streamType "final")
 *   - attachments: files the agent produced, **materialized to disk** — the base64 blob
 *                  is written out and only { name, contentType, bytes, path } is returned,
 *                  so multi-KB images never bloat the caller's context.
 */

const fs = require("fs");
const path = require("path");

const EXT_BY_TYPE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "text/csv": "csv",
  "text/plain": "txt",
  "text/html": "html",
  "application/json": "json",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

function firstMessageText(activities) {
  const m = (activities || []).filter((a) => a.type === "message" && a.text).pop();
  return m ? m.text : null;
}

function collectReasoning(activities) {
  const seen = new Set();
  const out = [];
  for (const a of activities || []) {
    for (const e of a.entities || []) {
      if (e.type === "thought" && e.text && e.text.trim() && !seen.has(e.text)) {
        seen.add(e.text);
        out.push(e.text.trim());
      }
    }
  }
  return out;
}

function collectSteps(activities) {
  const seen = new Set();
  const out = [];
  for (const a of activities || []) {
    const cd = a.channelData || {};
    const t = (a.text || "").trim();
    if (cd.streamType === "informative" && t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

// Long tool results can carry large business payloads; keep the summary compact.
const MAX_TOOL_RESULT_CHARS = 2000;

// A repeated "started" in the cumulative stream must not undo a later status. Any status
// other than "started" (completed, failed, or one we haven't seen) counts as later.
const toolStatusRank = (status) => (status === "started" ? 0 : 1);

// Tool calls usually arrive as `toolCall` entities on informative activities: one with
// status "started" (filled/unfilled parameters) and one with status "completed"
// (result, durationMs). Merge them into one record per toolCallId, in call order.
// Parameter and result field names follow the runtime's own names so they can be matched
// against `--raw`. Entities without a toolCallId can't be paired, so each one becomes its
// own record rather than being merged with an unrelated call.
function collectToolCalls(activities) {
  const byId = new Map();
  let anonymous = 0;
  for (const a of activities || []) {
    for (const e of a.entities || []) {
      if (e.type !== "toolCall") continue;
      const id = e.toolCallId || `${e.toolName || "tool"}#${anonymous++}`;
      const call = byId.get(id) || { id };
      if (e.toolName) call.name = e.toolName;
      if (e.toolCategory) call.category = e.toolCategory;
      if (
        e.status &&
        (call.status === undefined || toolStatusRank(e.status) >= toolStatusRank(call.status))
      ) {
        call.status = e.status;
      }
      const params = e.filledParameters;
      if (params && typeof params === "object" && !Array.isArray(params) && Object.keys(params).length) {
        call.filledParameters = e.filledParameters;
      }
      if (Array.isArray(e.unfilledParameters)) call.unfilledParameters = e.unfilledParameters;
      if (typeof e.durationMs === "number") call.durationMs = e.durationMs;
      if (e.result !== undefined && e.result !== null) {
        const r = typeof e.result === "string" ? e.result : JSON.stringify(e.result);
        if (r.length > MAX_TOOL_RESULT_CHARS) {
          call.result = r.slice(0, MAX_TOOL_RESULT_CHARS);
          call.resultTruncated = true;
          call.resultLength = r.length;
        } else {
          call.result = r;
        }
      }
      const error = e.error ?? e.errorMessage;
      if (error !== undefined && error !== null && error !== "") call.error = error;
      byId.set(id, call);
    }
  }
  return [...byId.values()];
}

function finalText(activities) {
  const msg = (activities || []).filter((a) => a.type === "message" && a.text).pop();
  if (msg) return msg.text;
  // Fallback: the longest cumulative streaming delta (answer-so-far).
  let best = "";
  for (const a of activities || []) {
    if (a.text && a.text.length > best.length) best = a.text;
  }
  return best || null;
}

function sanitizeName(name, contentType, index) {
  let base = (name || "").trim().replace(/[/\\]/g, "_").replace(/[^\w.\- ]/g, "");
  if (!base) {
    const ext = EXT_BY_TYPE[contentType] || "bin";
    base = `attachment-${index + 1}.${ext}`;
  } else if (!path.extname(base)) {
    const ext = EXT_BY_TYPE[contentType];
    if (ext) base += `.${ext}`;
  }
  return base;
}

function uniquePath(dir, name, used) {
  let candidate = path.join(dir, name);
  if (!used.has(candidate) && !fs.existsSync(candidate)) {
    used.add(candidate);
    return candidate;
  }
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let i = 1;
  while (true) {
    candidate = path.join(dir, `${stem}-${i}${ext}`);
    if (!used.has(candidate) && !fs.existsSync(candidate)) {
      used.add(candidate);
      return candidate;
    }
    i++;
  }
}

// Decode a data: URL to a Buffer, or return null for non-data URLs.
function decodeDataUrl(url) {
  const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(url || "");
  if (!m) return null;
  const mediaType = m[1] || "application/octet-stream";
  const isB64 = !!m[2];
  const data = m[3];
  const buf = isB64 ? Buffer.from(data, "base64") : Buffer.from(decodeURIComponent(data));
  return { mediaType, buf };
}

// Write out any attachments produced during the turn. `attachmentsDir` should already be
// scoped per-conversation by the caller. Returns lightweight descriptors (no base64).
function materializeAttachments(activities, attachmentsDir) {
  const out = [];
  const usedPaths = new Set();
  const dedupe = new Set(); // name:bytes so repeated identical attachments write once
  let index = 0;
  for (const a of activities || []) {
    for (const at of a.attachments || []) {
      const url = at.contentUrl || "";
      const decoded = url.startsWith("data:") ? decodeDataUrl(url) : null;
      if (decoded) {
        const contentType = at.contentType || decoded.mediaType || "application/octet-stream";
        const name = sanitizeName(at.name, contentType, index);
        const key = `${name}:${decoded.buf.length}`;
        index++;
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        fs.mkdirSync(attachmentsDir, { recursive: true });
        const outPath = uniquePath(attachmentsDir, name, usedPaths);
        fs.writeFileSync(outPath, decoded.buf);
        out.push({
          name: path.basename(outPath),
          contentType,
          bytes: decoded.buf.length,
          path: outPath,
        });
      } else if (url) {
        // A plain http(s) link — pass through without downloading.
        out.push({
          name: at.name || null,
          contentType: at.contentType || null,
          url,
        });
      }
      index++;
    }
  }
  return out;
}

/**
 * Distill a turn. `attachmentsDir` is where inline attachments are written.
 * `isStart` controls whether the greeting (from startActivities) is included.
 */
function summarizeTurn({
  startActivities = [],
  activities = [],
  attachmentsDir,
  isStart = false,
}) {
  const greeting = isStart ? firstMessageText(startActivities) : null;
  const attachments = attachmentsDir
    ? materializeAttachments(activities, attachmentsDir)
    : [];
  return {
    greeting,
    reasoning: collectReasoning(activities),
    steps: collectSteps(activities),
    tool_calls: collectToolCalls(activities),
    text: finalText(activities),
    attachments,
  };
}

module.exports = {
  summarizeTurn,
  // exported for reuse / testing
  collectReasoning,
  collectSteps,
  collectToolCalls,
  MAX_TOOL_RESULT_CHARS,
  finalText,
  materializeAttachments,
  decodeDataUrl,
};
