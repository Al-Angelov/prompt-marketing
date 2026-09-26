"""Operator-only troubleshooting logs, written to files end users never see.

Two rotating JSON-lines files under LOG_DIR (default: STORAGE_DIR/logs):
  - activity.log  everything the service does (INFO and above)
  - errors.log    warnings and errors only, with full tracebacks

Every line carries a trace id so one HTTP request or one market job can be
followed end to end: grep '"trace": "<id>"' activity.log. Secrets (the OpenAI
key, bearer tokens) are masked before anything is written.
"""

from __future__ import annotations

import json
import logging
import re
from collections import deque
from contextvars import ContextVar
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Iterable, Optional

LOG_FILES = {"activity": "activity.log", "errors": "errors.log"}
_MAX_BYTES = 5 * 1024 * 1024
_BACKUPS = 5

_trace: ContextVar[str] = ContextVar("trace", default="-")
_secrets: list[str] = []
_SECRET_PATTERNS = [re.compile(r"Bearer\s+[A-Za-z0-9._\-]+"), re.compile(r"sk-[A-Za-z0-9_\-]{8,}")]


def set_trace(trace_id: str):
    """Tag every following log line in this request/job with `trace_id`."""
    return _trace.set(trace_id)


def reset_trace(token) -> None:
    _trace.reset(token)


def redact(text: str) -> str:
    for secret in _secrets:
        text = text.replace(secret, "[redacted]")
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub("[redacted]", text)
    return text


class _TraceFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.trace = _trace.get()
        return True


class _JsonLineFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "trace": getattr(record, "trace", "-"),
            "logger": record.name,
            "thread": record.threadName,
            "msg": redact(record.getMessage()),
        }
        if record.exc_info:
            entry["exc"] = redact(self.formatException(record.exc_info))
        return json.dumps(entry, ensure_ascii=False)


def trace_filter() -> logging.Filter:
    return _TraceFilter()


def file_handlers(log_dir: Path, level: int, secrets: Iterable[str]) -> list[logging.Handler]:
    """Rotating activity + error file handlers for the root logger."""
    _secrets[:] = [s for s in secrets if s and len(s) >= 8]
    log_dir.mkdir(parents=True, exist_ok=True)
    handlers = []
    for name, handler_level in (("activity", level), ("errors", logging.WARNING)):
        handler = RotatingFileHandler(log_dir / LOG_FILES[name], maxBytes=_MAX_BYTES, backupCount=_BACKUPS, encoding="utf-8")
        handler.setLevel(handler_level)
        handler.setFormatter(_JsonLineFormatter())
        handler.addFilter(_TraceFilter())
        handlers.append(handler)
    return handlers


def tail(log_dir: Path, name: str, lines: int, trace: Optional[str] = None) -> list[dict]:
    """Last `lines` entries of a log file, optionally for one trace id."""
    path = log_dir / LOG_FILES[name]
    if not path.exists():
        return []
    kept: deque = deque(maxlen=lines)
    with path.open(encoding="utf-8", errors="replace") as stream:
        for line in stream:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if trace is None or entry.get("trace") == trace:
                kept.append(entry)
    return list(kept)
