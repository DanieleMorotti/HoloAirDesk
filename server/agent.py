"""HOLO agent: streams a llama.cpp chat completion, executes file tools,
and relays everything to the browser as Server-Sent Events."""
import json
from typing import AsyncIterator, Optional

import httpx
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .config import LLAMA_URL, LLM_TEMPERATURE, MAX_HISTORY_MESSAGES, MAX_TOOL_ROUNDS, file_kind
from .files import delete_file, list_files, read_text_file, safe_path, write_text_file

router = APIRouter()

# In-process chat history, one list of OpenAI-style messages per browser session.
SESSIONS: dict = {}

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "open_file",
            "description": "Open a library file in a holographic window on the user's screen. Works for text, image and audio files.",
            "parameters": {
                "type": "object",
                "properties": {"name": {"type": "string", "description": "Exact file name from the library"}},
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the content of a TEXT file from the library. Images and audio cannot be read.",
            "parameters": {
                "type": "object",
                "properties": {"name": {"type": "string", "description": "Exact file name from the library"}},
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create a new TEXT file or overwrite an existing one with the given content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "File name, e.g. notes.txt"},
                    "content": {"type": "string", "description": "Full new content of the file"},
                },
                "required": ["name", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_file",
            "description": "Permanently delete a file from the library.",
            "parameters": {
                "type": "object",
                "properties": {"name": {"type": "string", "description": "Exact file name from the library"}},
                "required": ["name"],
            },
        },
    },
]


def build_system_prompt(open_files: list) -> str:
    lib = ", ".join(f"{f['name']} ({f['kind']})" for f in list_files()) or "(empty)"
    opened = ", ".join(open_files) if open_files else "(none)"
    return (
        "You are HOLO, the voice assistant of a holographic desktop. "
        "The user talks by voice; replies are shown in a small chat panel.\n"
        f"Library files: {lib}\n"
        f"Files currently open on screen: {opened}\n"
        "Rules:\n"
        "- Be extremely concise: one short sentence when possible, no filler, no markdown.\n"
        "- Always answer in the user's language.\n"
        "- Call tools only when needed, then answer immediately.\n"
        "- Only text files can be read or written; images and audio can only be opened or deleted.\n"
        "- Never invent files that are not in the library."
    )


def run_tool(name: str, args: dict):
    """Execute one tool. Returns (result_text_for_model, ui_event_or_None)."""
    fname = (args.get("name") or "").strip()
    try:
        if name == "open_file":
            path = safe_path(fname)
            if not path.exists():
                return f"Error: {fname} not found in library.", None
            return f"{fname} is now open on screen.", {"type": "open_file", "name": fname}
        if name == "read_file":
            return read_text_file(fname), None
        if name == "write_file":
            write_text_file(fname, args.get("content") or "")
            return f"{fname} saved.", {"type": "file_changed", "name": fname, "kind": file_kind(fname)}
        if name == "delete_file":
            delete_file(fname)
            return f"{fname} deleted.", {"type": "file_deleted", "name": fname}
        return f"Error: unknown tool {name}.", None
    except (ValueError, FileNotFoundError) as e:
        return f"Error: {e}", None


class ChatRequest(BaseModel):
    session_id: str
    message: str
    open_files: list = []


def sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def stream_completion(client: httpx.AsyncClient, messages: list):
    """One streamed llama-server round. Yields ('delta', text) chunks and finally
    ('end', (content, tool_calls))."""
    content_parts = []
    tool_calls: dict = {}  # index -> {id, name, arguments}
    payload = {
        "model": "default",
        "messages": messages,
        "tools": TOOLS,
        "stream": True,
        "temperature": LLM_TEMPERATURE,
    }
    async with client.stream("POST", f"{LLAMA_URL}/v1/chat/completions", json=payload) as resp:
        resp.raise_for_status()
        async for line in resp.aiter_lines():
            if not line.startswith("data: "):
                continue
            data = line[6:].strip()
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue
            choices = chunk.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            if delta.get("content"):
                content_parts.append(delta["content"])
                yield "delta", delta["content"]
            for tc in delta.get("tool_calls") or []:
                idx = tc.get("index", 0)
                slot = tool_calls.setdefault(idx, {"id": None, "name": "", "arguments": ""})
                if tc.get("id"):
                    slot["id"] = tc["id"]
                fn = tc.get("function") or {}
                if fn.get("name"):
                    slot["name"] = fn["name"]
                if fn.get("arguments"):
                    slot["arguments"] += fn["arguments"]
    calls = [tool_calls[i] for i in sorted(tool_calls)]
    yield "end", ("".join(content_parts), calls)


async def agent_events(req: ChatRequest) -> AsyncIterator[str]:
    history = SESSIONS.setdefault(req.session_id, [])
    history.append({"role": "user", "content": req.message})
    del history[:-MAX_HISTORY_MESSAGES]
    messages = [{"role": "system", "content": build_system_prompt(req.open_files)}] + list(history)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=5)) as client:
            for _ in range(MAX_TOOL_ROUNDS):
                content, calls = "", []
                async for kind, value in stream_completion(client, messages):
                    if kind == "delta":
                        yield sse({"type": "delta", "text": value})
                    else:
                        content, calls = value

                if not calls:
                    history.append({"role": "assistant", "content": content})
                    yield sse({"type": "done"})
                    return

                assistant_msg = {
                    "role": "assistant",
                    "content": content or None,
                    "tool_calls": [
                        {
                            "id": c["id"] or f"call_{i}",
                            "type": "function",
                            "function": {"name": c["name"], "arguments": c["arguments"] or "{}"},
                        }
                        for i, c in enumerate(calls)
                    ],
                }
                messages.append(assistant_msg)
                history.append(assistant_msg)

                for i, call in enumerate(calls):
                    try:
                        args = json.loads(call["arguments"] or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    yield sse({"type": "tool", "name": call["name"], "args": args})
                    result, event = run_tool(call["name"], args)
                    if event:
                        yield sse(event)
                    tool_msg = {
                        "role": "tool",
                        "tool_call_id": call["id"] or f"call_{i}",
                        "content": result,
                    }
                    messages.append(tool_msg)
                    history.append(tool_msg)

            yield sse({"type": "error", "message": "tool round limit reached"})
            yield sse({"type": "done"})
    except httpx.HTTPError as e:
        yield sse({"type": "error", "message": f"LLM server error: {e}"})
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
