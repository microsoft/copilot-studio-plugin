/**
 * terminal-render.js — optional pretty renderer for a live terminal chat experience.
 *
 * Only used when `--pretty` is passed (or stdout is a TTY). It renders, as the turn streams:
 *   - reasoning (chain-of-thought) as dim cyan lines
 *   - tool/status cues ("Running Bash...") as dim chips
 * then, at the end of the turn, the final answer with lightweight Markdown -> ANSI styling
 * and a list of any materialized attachment files.
 *
 * The default (machine) output path does NOT use this — it emits distilled JSON instead.
 */

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  italic: "\x1b[3m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
  reverse: "\x1b[7m",
};

function supportsColor(stream) {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return !!(stream && stream.isTTY);
}

function paint(color, enabled) {
  return (s) => (enabled ? color + s + C.reset : s);
}

// Very small Markdown -> ANSI transform. Handles the constructs these agents emit
// (headings, bold, inline code, fenced code, bullets, rules, blockquotes). Tables and
// links are passed through mostly as-is.
function renderMarkdown(md, enabled) {
  const b = paint(C.bold, enabled);
  const dim = paint(C.dim, enabled);
  const cyan = paint(C.cyan, enabled);
  const code = paint(C.green, enabled);
  const inline = (s) =>
    enabled ? s.replace(/`([^`]+)`/g, (_, x) => C.reverse + " " + x + " " + C.reset) : s;
  const boldInline = (s) =>
    enabled ? s.replace(/\*\*([^*]+)\*\*/g, (_, x) => C.bold + x + C.reset) : s;

  const lines = String(md || "").split("\n");
  const out = [];
  let inFence = false;
  for (const raw of lines) {
    const fence = /^\s*```/.test(raw);
    if (fence) {
      inFence = !inFence;
      const lang = raw.replace(/^\s*```/, "").trim();
      out.push(dim("┌─ " + (inFence ? lang || "code" : "")).trimEnd());
      continue;
    }
    if (inFence) {
      out.push(dim("│ ") + code(raw));
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
      out.push(dim("─".repeat(48)));
      continue;
    }
    let line = raw;
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const text = boldInline(inline(h[2]));
      out.push(cyan(b(text)));
      continue;
    }
    // bullets
    line = line.replace(/^(\s*)[-*]\s+/, (_, sp) => sp + "• ");
    // blockquote
    if (/^\s*>\s?/.test(line)) {
      line = dim("│ ") + line.replace(/^\s*>\s?/, "");
    }
    out.push(boldInline(inline(line)));
  }
  return out.join("\n");
}

function humanBytes(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * Live renderer bound to an output stream. Feed it every streamed activity via
 * onActivity(); call finishTurn(summary) once the turn ends to print the answer + files.
 */
function createLiveRenderer({ out = process.stdout } = {}) {
  const enabled = supportsColor(out);
  const dim = paint(C.dim, enabled);
  const cyan = paint(C.cyan, enabled);
  const yellow = paint(C.yellow, enabled);
  const magenta = paint(C.magenta, enabled);
  const b = paint(C.bold, enabled);
  const seenThoughts = new Set();
  const seenSteps = new Set();
  const w = (s) => out.write(s + "\n");

  function onActivity(activity) {
    const cd = activity.channelData || {};
    // Tool / status cue.
    const t = (activity.text || "").trim();
    if (cd.streamType === "informative" && t && !seenSteps.has(t)) {
      seenSteps.add(t);
      w(dim("  ⚙ " + t));
    }
    // Reasoning (chain-of-thought).
    for (const e of activity.entities || []) {
      if (e.type === "thought" && e.text && e.text.trim() && !seenThoughts.has(e.text)) {
        seenThoughts.add(e.text);
        w(cyan("  🧠 " + e.text.trim()));
      }
    }
  }

  function greeting(text) {
    if (text) w("\n" + magenta(b("agent")) + " " + text + "\n");
  }

  function userEcho(text) {
    w("\n" + yellow(b("you")) + "  " + text);
  }

  function finishTurn(summary) {
    if (summary.text) {
      w("\n" + magenta(b("agent")));
      w(renderMarkdown(summary.text, enabled));
    }
    if (summary.attachments && summary.attachments.length) {
      w("\n" + dim("attachments:"));
      for (const a of summary.attachments) {
        const meta = [a.contentType, humanBytes(a.bytes)].filter(Boolean).join(", ");
        w(dim("  📎 ") + (a.path || a.url) + (meta ? dim("  (" + meta + ")") : ""));
      }
    }
    w("");
  }

  return { onActivity, finishTurn, greeting, userEcho, enabled };
}

module.exports = { createLiveRenderer, renderMarkdown, supportsColor, humanBytes };
