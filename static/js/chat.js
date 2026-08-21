// Chat panel + SSE client for the HOLO agent.
import * as windows from "/js/windows.js";
import * as selection from "/js/selection.js";
import { sfx } from "/js/sfx.js";
import { toast } from "/js/hud.js";

const sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
let panel, messages, busy = false;

function placeholder() {
  const p = document.createElement("div");
  p.className = "chat-placeholder";
  p.textContent = "VOICE LINK READY — TAP THE MIC AND SPEAK";
  messages.appendChild(p);
}

function addMsg(cls, text = "") {
  messages.querySelector(".chat-placeholder")?.remove();
  panel.classList.remove("min"); // new activity re-expands a minimized chat
  const div = document.createElement("div");
  div.className = `msg ${cls}`;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

// minimal markdown: the model occasionally emits **bold** / `code` anyway
function fmt(text) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

const TOOL_LABELS = {
  open_file: "OPENING",
  read_file: "READING",
  write_file: "WRITING",
  replace_text: "EDITING",
  delete_file: "DELETING",
};

export function isBusy() { return busy; }

export async function send(text) {
  if (busy || !text.trim()) return;
  busy = true;

  // a pinch-selected text fragment rides along as context for the agent
  const sel = selection.consume();
  let agentMessage = text;
  if (sel) {
    agentMessage = `[User selected this text from ${sel.file}]:\n"""\n${sel.text}\n"""\n\n${text}`;
    const att = addMsg("user selection");
    att.textContent = `✂ ${sel.file} — ${sel.text.length > 120 ? sel.text.slice(0, 120) + "…" : sel.text}`;
  }
  addMsg("user", text);
  let holoMsg = null, holoText = "";
  const ensureHolo = () => holoMsg || (holoMsg = addMsg("holo streaming"));
  const appendDelta = (t) => {
    holoText += t;
    ensureHolo().innerHTML = fmt(holoText);
    messages.scrollTop = messages.scrollHeight;
  };

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message: agentMessage, open_files: windows.getOpenFiles() }),
    });
    if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop();
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data: ")) continue;
        let ev;
        try { ev = JSON.parse(line.slice(6)); } catch { continue; }
        await handleEvent(ev, appendDelta);
      }
    }
  } catch (e) {
    addMsg("error", `link error: ${e.message}`);
    sfx.error();
  } finally {
    holoMsg?.classList.remove("streaming");
    if (holoMsg && !holoMsg.textContent.trim()) holoMsg.remove();
    busy = false;
  }
}

async function handleEvent(ev, appendDelta) {
  switch (ev.type) {
    case "delta":
      appendDelta(ev.text);
      break;
    case "tool":
      addMsg("tool", `⟐ ${TOOL_LABELS[ev.name] || ev.name} ${ev.args?.name || ""}`.trim());
      break;
    case "open_file":
      await windows.openFile(ev.name);
      break;
    case "file_changed":
      await windows.refreshFile(ev.name);
      toast(`FILE UPDATED — ${ev.name}`);
      break;
    case "file_deleted":
      await windows.fileDeleted(ev.name);
      toast(`FILE DELETED — ${ev.name}`);
      break;
    case "error":
      addMsg("error", ev.message);
      sfx.error();
      break;
  }
}

export function init() {
  panel = document.getElementById("chat");
  messages = document.getElementById("chat-messages");
  placeholder();
  document.getElementById("chat-min").addEventListener("click", () => {
    panel.classList.toggle("min");
  });
  document.getElementById("chat-clear").addEventListener("click", async () => {
    messages.innerHTML = "";
    placeholder();
    await fetch("/api/chat/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => {});
  });
}
