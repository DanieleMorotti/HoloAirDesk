"""HOLO agent on the OpenAI Agents SDK, backed by the local llama-server.

The SDK drives the tool loop; we just bridge its stream to SSE events the
browser understands, and keep a short per-session history (last 10 user /
assistant messages, no tool traffic, no thinking tracks).
"""
import json
import re
from typing import AsyncIterator

from agents import (
    Agent,
    ModelSettings,
    OpenAIChatCompletionsModel,
    RunContextWrapper,
    Runner,
    function_tool,
    set_tracing_disabled,
)
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel

from .config import LLAMA_URL, LLM_TEMPERATURE, file_kind
from .files import (
    delete_file,
    list_files,
    read_text_file,
    replace_in_text_file,
    safe_path,
    write_text_file,
)

router = APIRouter()
set_tracing_disabled(True)  # local-only, no OpenAI backend

llm = OpenAIChatCompletionsModel(
    model="default",
    openai_client=AsyncOpenAI(base_url=f"{LLAMA_URL}/v1", api_key="local"),
)

MAX_HISTORY = 10
MAX_TURNS = 6
SESSIONS: dict = {}  # session_id -> [{"role","content"}, ...]
THINK_RE = re.compile(r"<think>.*?(</think>|$)\s*", re.DOTALL)
# the selection block the frontend prepends to a voice message
SELECTION_RE = re.compile(
    r'\[User selected this text from (?P<file>[^\]]+)\]:\n"""\n(?P<text>.*?)\n"""', re.DOTALL
)


@function_tool
def open_file(ctx: RunContextWrapper, name: str) -> str:
    """Open a library file in a holographic window on the user's screen. Works for text, image and audio files.

    Args:
        name: Exact file name from the library.
    """
    try:
        if not safe_path(name).exists():
            return f"Error: {name} not found in library."
    except ValueError as e:
        return f"Error: {e}"
    opened = (ctx.context or {}).get("open_files")
    if opened is not None and name not in opened:
        opened.append(name)  # keep the open-state current within this turn
    kind = file_kind(name)
    if kind in ("image", "audio"):
        return (f"{name} ({kind}) is now open and visible on the user's screen. "
                "Binary content cannot be read — no further action is needed.")
    return f"{name} is now open on screen."


@function_tool
def read_file(name: str) -> str:
    """Read the content of a TEXT file from the library. Images and audio cannot be read.

    Args:
        name: Exact file name from the library.
    """
    try:
        return read_text_file(name)
    except (ValueError, FileNotFoundError) as e:
        return f"Error: {e}"


@function_tool
def write_file(name: str, content: str) -> str:
    """Create a new TEXT file or overwrite an existing one with the given content.

    Args:
        name: File name, e.g. notes.txt.
        content: Full new content of the file.
    """
    try:
        write_text_file(name, _unescape(content))
    except ValueError as e:
        return f"Error: {e}"
    return f"{name} saved."


def _unescape(text: str) -> str:
    # small models sometimes double-escape newlines in tool arguments
    if "\\n" in text and "\n" not in text:
        text = text.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\t", "\t")
    return text


@function_tool
def replace_selected_text(ctx: RunContextWrapper, new_text: str) -> str:
    """Replace the text the user has currently selected on screen with new_text. Use this whenever the user asks to change, correct, fix or rewrite their selected text — the old text is filled in automatically.

    Args:
        new_text: The replacement text for the selection.
    """
    sel = (ctx.context or {}).get("selection")
    if not sel:
        return "Error: the user has no text selected."
    try:
        replace_in_text_file(sel["file"], sel["text"], _unescape(new_text))
    except (ValueError, FileNotFoundError) as e:
        return f"Error: {e}"
    return f"{sel['file']} updated with the new text."


@function_tool
def close_file(ctx: RunContextWrapper, name: str) -> str:
    """Close a file window that is currently open on the user's screen.

    Args:
        name: Exact file name of the open window to close.
    """
    open_files = (ctx.context or {}).get("open_files")
    if not open_files or name not in open_files:
        return f"Error: {name} is not open on screen — there is nothing to close."
    open_files.remove(name)
    return f"{name} closed."


@function_tool
def play_pause_audio(name: str) -> str:
    """Start or pause playback of an audio file. If the file is not open yet, it is opened and starts playing.

    Args:
        name: Exact audio file name from the library.
    """
    try:
        if not safe_path(name).exists():
            return f"Error: {name} not found in library."
    except ValueError as e:
        return f"Error: {e}"
    if file_kind(name) != "audio":
        return f"Error: {name} is not an audio file."
    return f"Playback of {name} toggled."


@function_tool(name_override="delete_file")
def delete_file_tool(name: str) -> str:
    """Permanently delete a file from the library.

    Args:
        name: Exact file name from the library.
    """
    try:
        delete_file(name)
    except (ValueError, FileNotFoundError) as e:
        return f"Error: {e}"
    return f"{name} deleted."


TOOLS = [open_file, read_file, write_file, close_file, play_pause_audio, delete_file_tool]

# tool name -> UI event sent to the browser on success
UI_EVENTS = {
    "open_file": lambda a: {"type": "open_file", "name": a.get("name", "")},
    "write_file": lambda a: {"type": "file_changed", "name": a.get("name", ""),
                             "kind": file_kind(a.get("name", ""))},
    "close_file": lambda a: {"type": "close_file", "name": a.get("name", "")},
    "play_pause_audio": lambda a: {"type": "toggle_audio", "name": a.get("name", "")},
    "delete_file": lambda a: {"type": "file_deleted", "name": a.get("name", "")},
}


def build_agent(open_files: list, selection: dict = None) -> Agent:
    lib = ", ".join(f"{f['name']} ({f['kind']})" for f in list_files()) or "(empty)"
    opened = ", ".join(open_files) if open_files else "(none)"

    lines = [
        "You are HOLO, the voice assistant of a holographic desktop. "
        "The user talks by voice; replies are shown in a small chat panel.",
        f"Library files: {lib}",
        f"Files currently open on screen: {opened}",
    ]
    if selection:
        lines.append(
            f"Selected text by user: the user has an active selection in {selection['file']} "
            "(quoted at the top of their message)."
        )
    lines += [
        "Rules:",
        "- Be extremely concise: one short sentence when possible, no filler, no markdown.",
        "- Always answer in the user's language.",
        "- Call tools only when needed, then answer immediately.",
        "- open_file shows ANY file type (text, image, audio) on the user's screen. "
        "If the user asks to open/show/display a file, open_file alone is enough.",
        "- read_file and write_file work ONLY on text files. NEVER call read_file or "
        "write_file on an image or audio file: you cannot see or hear their content, "
        "and opening them already shows them to the user.",
        "- delete_file works on any file type.",
        "- close_file closes a window that is open on screen (it does not delete anything). "
        "If asked to close a file that is not open, just say it is not open — never open it first.",
        "- play_pause_audio starts or pauses an audio file; it opens the player if needed.",
    ]
    if selection:
        lines.append(
            "- When the user asks to change, correct, fix or rewrite their selected text, "
            "call replace_selected_text(new_text) directly — do NOT read the file first, "
            "the selected text is replaced automatically."
        )
    lines += [
        "- To edit a text file when nothing is selected: first read_file, then write_file "
        "with the complete updated content.",
        "- Never invent files that are not in the library.",
        "- Never start your reply with the '[' character (it breaks the display); "
        "begin with a word instead.",
    ]

    return Agent(
        name="HOLO",
        model=llm,
        model_settings=ModelSettings(temperature=LLM_TEMPERATURE),
        # the selection tool is only offered while a selection actually exists
        tools=TOOLS + ([replace_selected_text] if selection else []),
        instructions="\n".join(lines),
    )


class ChatRequest(BaseModel):
    session_id: str
    message: str
    open_files: list = []


def sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def agent_events(req: ChatRequest) -> AsyncIterator[str]:
    history = SESSIONS.setdefault(req.session_id, [])
    calls = {}  # call_id -> (tool_name, args)

    m = SELECTION_RE.search(req.message)
    selection = {"file": m.group("file"), "text": m.group("text")} if m else None
    agent = build_agent(req.open_files, selection)

    try:
        result = Runner.run_streamed(
            agent,
            input=history[-MAX_HISTORY:] + [{"role": "user", "content": req.message}],
            max_turns=MAX_TURNS,
            context={"selection": selection, "open_files": list(req.open_files)},
        )
        async for event in result.stream_events():
            if event.type == "raw_response_event":
                if getattr(event.data, "type", "") == "response.output_text.delta":
                    yield sse({"type": "delta", "text": event.data.delta})
            elif event.type == "run_item_stream_event":
                item = event.item
                if item.type == "tool_call_item":
                    raw = item.raw_item
                    try:
                        args = json.loads(getattr(raw, "arguments", "") or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    calls[getattr(raw, "call_id", "")] = (raw.name, args)
                    yield sse({"type": "tool", "name": raw.name, "args": args})
                elif item.type == "tool_call_output_item":
                    raw = item.raw_item
                    call_id = raw.get("call_id", "") if isinstance(raw, dict) else getattr(raw, "call_id", "")
                    name, args = calls.get(call_id, ("", {}))
                    output = str(item.output or "")
                    if output.startswith("Error"):
                        pass
                    elif name == "replace_selected_text" and selection:
                        yield sse({"type": "file_changed", "name": selection["file"],
                                   "kind": file_kind(selection["file"])})
                    elif name in UI_EVENTS:
                        yield sse(UI_EVENTS[name](args))

        final = THINK_RE.sub("", str(result.final_output or "")).strip()
        history.append({"role": "user", "content": req.message})
        history.append({"role": "assistant", "content": final})
        del history[:-MAX_HISTORY]
    except Exception as e:  # MaxTurnsExceeded, model/server errors, ...
        yield sse({"type": "error", "message": f"agent error: {e}"})
    yield sse({"type": "done"})


@router.post("/api/chat")
async def api_chat(req: ChatRequest):
    return StreamingResponse(
        agent_events(req),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/chat/reset")
async def api_chat_reset(body: dict):
    SESSIONS.pop(body.get("session_id", ""), None)
    return {"ok": True}
