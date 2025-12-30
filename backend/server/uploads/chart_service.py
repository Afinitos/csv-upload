import json
import os
from typing import Any, Dict, List, Optional


class ChartServiceError(RuntimeError):
    pass


def _safe_json(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def generate_chart_spec(
    *,
    question: str,
    sql: str,
    rows: List[Dict[str, Any]],
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """Generate a simple chart spec for frontend rendering.

    This is intentionally small / constrained so the frontend can render it
    without heavy dependencies.

    Output schema (example):
    {
      "type": "bar" | "line" | "number" | "table",
      "title": "...",
      "xKey": "workbook",
      "yKey": "upload_count",
      "description": "..."
    }

    Notes:
    - We keep the allowed chart types small to reduce hallucinations.
    - We pass only a small sample of rows to avoid leaking too much data.
    """

    if not question:
        raise ChartServiceError("question is required")

    # Avoid sending too much data to the LLM.
    sample = rows[:20]
    columns = sorted({k for r in sample for k in r.keys()})

    openai_api_key = os.getenv("OPENAI_API_KEY", "")
    if not openai_api_key:
        raise ChartServiceError("OPENAI_API_KEY is not set")

    llm_model = model or os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    # Use OpenAI SDK v1 (the repo already uses `from openai import OpenAI` via Vanna)
    from openai import OpenAI

    client = OpenAI(api_key=openai_api_key)

    system = (
        "You are a data visualization assistant. "
        "Given a user's question, a SQL query, and a small JSON sample of the result rows, "
        "you must output ONLY valid JSON (no markdown) describing how to visualize the result. "
        "\n\n"
        "Constraints:\n"
        "- Allowed chart types: bar, line, number, table.\n"
        "- Prefer 'number' when there is exactly one numeric value (single-row single-metric).\n"
        "- Prefer 'bar' when there is a categorical column + numeric metric (grouped counts/sums).\n"
        "- Prefer 'line' when xKey looks like a date/time and yKey is numeric.\n"
        "- If you cannot find a sensible chart, use type 'table'.\n"
        "- Do NOT invent columns. Choose xKey/yKey only from the provided columns list.\n"
        "- Keep title short.\n\n"
        "Output JSON schema:\n"
        "{\"type\":\"bar|line|number|table\",\"title\":string,\"xKey\":string|null,\"yKey\":string|null,\"description\":string}"
    )

    user = (
        f"Question: {question}\n"
        f"SQL: {sql}\n"
        f"Columns: {columns}\n"
        f"Rows (sample up to 20): {_safe_json(sample)}\n"
    )

    resp = client.chat.completions.create(
        model=llm_model,
        temperature=0,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )

    content = (resp.choices[0].message.content or "").strip()
    try:
        spec = json.loads(content)
    except Exception as e:
        raise ChartServiceError(f"Chart spec is not valid JSON: {e}. Raw: {content}")

    # Minimal validation
    if not isinstance(spec, dict):
        raise ChartServiceError(f"Chart spec must be an object. Got: {type(spec)}")

    chart_type = str(spec.get("type", "table"))
    if chart_type not in ("bar", "line", "number", "table"):
        spec["type"] = "table"

    # Prevent hallucinated keys
    x_key = spec.get("xKey")
    y_key = spec.get("yKey")
    if x_key is not None and x_key not in columns:
        spec["xKey"] = None
    if y_key is not None and y_key not in columns:
        spec["yKey"] = None

    # Ensure required fields
    spec.setdefault("title", "Chart")
    spec.setdefault("description", "")

    return spec

