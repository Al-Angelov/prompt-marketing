"""Thin wrapper around the OpenAI SDK.

Exposes a single `run_structured_research` helper that:
  - uses the Responses API with the hosted `web_search` tool when enabled
    (required for genuinely grounded results), and
  - falls back to Chat Completions JSON mode otherwise (demo-only, ungrounded).

Both paths return parsed JSON validated against the caller-supplied schema class.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional, Type, TypeVar

from openai import OpenAI, OpenAIError
from pydantic import BaseModel, ValidationError

from app.config import get_logger, get_settings

logger = get_logger(__name__)

T = TypeVar("T", bound=BaseModel)

_client: Optional[OpenAI] = None


class ResearchError(RuntimeError):
    """Raised when an OpenAI research call fails or returns unusable output."""


def get_client() -> OpenAI:
    """Return a lazily-initialized, process-wide OpenAI client."""
    global _client
    if _client is None:
        settings = get_settings()
        if not settings.openai_api_key:
            raise ResearchError(
                "OPENAI_API_KEY is not set. Set it in your environment or local .env file."
            )
        _client = OpenAI(api_key=settings.openai_api_key, timeout=70.0, max_retries=0)
        logger.info("initialized OpenAI client model=%s", settings.openai_model)
    return _client


def _extract_json(text: str) -> Dict[str, Any]:
    """Best-effort extraction of a JSON object from a model text response."""
    text = text.strip()
    # Strip Markdown code fences if present.
    if text.startswith("```"):
        text = text.split("```", 2)[1] if "```" in text[3:] else text
        text = text.lstrip("json").strip("`").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Fall back to the outermost brace pair.
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _run_with_responses_api(
    system_prompt: str, user_prompt: str, schema_name: str
) -> Dict[str, Any]:
    """Use the Responses API with the hosted web_search tool for grounding."""
    settings = get_settings()
    client = get_client()

    response = client.responses.create(
        model=settings.openai_model,
        tools=[{"type": "web_search"}],
        include=["web_search_call.action.sources"],
        input=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    text = getattr(response, "output_text", None)
    if not text:
        raise ResearchError("Empty response from Responses API.")
    logger.info("responses api call complete schema=%s chars=%d", schema_name, len(text))
    searched = False
    urls = set()
    for item in response.output:
        if getattr(item, "type", None) == "web_search_call":
            searched = True
            for source in getattr(getattr(item, "action", None), "sources", None) or []:
                url = source.get("url") if isinstance(source, dict) else getattr(source, "url", None)
                if url:
                    urls.add(url)
        for content in getattr(item, "content", None) or []:
            for annotation in getattr(content, "annotations", None) or []:
                if getattr(annotation, "type", None) == "url_citation":
                    urls.add(annotation.url)
    if not searched:
        raise ResearchError("No web search was performed; refusing to label model knowledge as researched evidence.")
    raw = _extract_json(text)
    raw["research_mode"] = "web_search"
    raw["retrieved_source_urls"] = sorted(urls)
    return raw


def _run_with_chat_completions(
    system_prompt: str, user_prompt: str, schema_name: str
) -> Dict[str, Any]:
    """Fallback path: Chat Completions JSON mode (no web grounding)."""
    settings = get_settings()
    client = get_client()

    completion = client.chat.completions.create(
        model=settings.openai_model,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    text = completion.choices[0].message.content or ""
    if not text:
        raise ResearchError("Empty response from Chat Completions API.")
    logger.info("chat api call complete schema=%s chars=%d", schema_name, len(text))
    raw = _extract_json(text)
    raw["research_mode"] = "ungrounded_demo"
    raw["retrieved_source_urls"] = []
    return raw


def run_structured_research(
    system_prompt: str,
    user_prompt: str,
    schema: Type[T],
) -> T:
    """Execute a research call and validate the result against `schema`.

    Chooses the grounded Responses+web_search path when ENABLE_WEB_SEARCH is
    true, else the ungrounded Chat Completions fallback.
    """
    settings = get_settings()
    schema_name = schema.__name__

    try:
        if settings.enable_web_search:
            # A failed grounded call must not become a successful ungrounded report.
            raw = _run_with_responses_api(system_prompt, user_prompt, schema_name)
        else:
            raw = _run_with_chat_completions(system_prompt, user_prompt, schema_name)
    except OpenAIError as exc:
        logger.exception("OpenAI API call failed schema=%s", schema_name)
        raise ResearchError(f"OpenAI API call failed: {exc}") from exc
    except (json.JSONDecodeError, ValueError) as exc:
        logger.exception("Failed to parse model JSON schema=%s", schema_name)
        raise ResearchError(f"Model returned unparseable JSON: {exc}") from exc

    try:
        return schema.model_validate(raw)
    except ValidationError as exc:
        logger.error("Schema validation failed schema=%s errors=%s", schema_name, exc)
        raise ResearchError(
            f"Model output did not match {schema_name} schema: {exc}"
        ) from exc
