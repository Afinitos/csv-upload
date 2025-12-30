# uploads/vanna_tools.py
from __future__ import annotations

from typing import Any, Dict, List, Optional, get_args
from pydantic import BaseModel, Field

from vanna.core.tool import Tool, ToolContext, ToolResult
from vanna.components import UiComponent, SimpleTextComponent

# ChartComponent se može razlikovati po verzijama; importamo ga i onda se prilagodimo.
from vanna.components import ChartComponent


class ChartArgs(BaseModel):
    data: List[Dict[str, Any]] = Field(..., description="SQL result rows as list of dicts")
    x_field: str = Field(..., description="Key for x axis")
    y_field: str = Field(..., description="Key for y axis")
    chart_type: str = Field("bar", description="bar|line|scatter (depending on supported chart types)")
    title: Optional[str] = Field(None, description="Optional title")


def _literal_options(annotation) -> List[str]:
    """Extract Literal['a','b'] options if present."""
    try:
        opts = list(get_args(annotation))
        return [o for o in opts if isinstance(o, str)]
    except Exception:
        return []


def _pick_supported_type() -> str:
    """
    Pick a valid value for ChartComponent.type based on its schema.
    Some versions expect 'chart', some 'plotly', etc.
    """
    f = getattr(ChartComponent, "model_fields", {}).get("type")
    if not f:
        return "chart"
    opts = _literal_options(f.annotation)
    if not opts:
        return "chart"
    # Prefer common ones
    for preferred in ("chart", "plotly", "vega_lite", "vega", "echarts"):
        if preferred in opts:
            return preferred
    return opts[0]


def _build_chart_payload(args: ChartArgs) -> Dict[str, Any]:
    """
    Build a dict that matches ChartComponent for *this installed version*.
    We create a Plotly-like spec by default, but field names differ by version.
    """
    x = [row.get(args.x_field) for row in args.data]
    y = [row.get(args.y_field) for row in args.data]

    plotly_spec = {
        "data": [{"type": args.chart_type, "x": x, "y": y}],
        "layout": {
            "title": args.title or f"{args.y_field} by {args.x_field}",
            "xaxis": {"title": args.x_field},
            "yaxis": {"title": args.y_field},
        },
    }

    # Introspect which fields exist on ChartComponent
    fields = getattr(ChartComponent, "model_fields", {})
    payload: Dict[str, Any] = {}

    # Required-ish fields
    payload_type = _pick_supported_type()
    if "type" in fields:
        payload["type"] = payload_type

    # Common fields across versions
    if "title" in fields:
        payload["title"] = args.title or f"{args.y_field} by {args.x_field}"

    # Some versions: chart_type separate
    if "chart_type" in fields:
        payload["chart_type"] = args.chart_type

    # Most versions: spec exists
    if "spec" in fields:
        payload["spec"] = plotly_spec

    # Some versions: data/layout separate
    if "data" in fields and "layout" in fields:
        payload["data"] = plotly_spec["data"]
        payload["layout"] = plotly_spec["layout"]

    # Some versions: renderer/engine field (plotly/vega)
    # If such field exists, try set it to something sensible.
    for engine_field in ("engine", "renderer", "library"):
        if engine_field in fields:
            # try to choose allowed enum if literal
            opts = _literal_options(fields[engine_field].annotation)
            if "plotly" in opts:
                payload[engine_field] = "plotly"
            elif opts:
                payload[engine_field] = opts[0]
            else:
                payload[engine_field] = "plotly"

    return payload


class CustomChartTool(Tool[ChartArgs]):
    @property
    def name(self) -> str:
        return "create_custom_chart"

    @property
    def description(self) -> str:
        return (
            "Create an interactive chart from SQL result rows. "
            "IMPORTANT: you MUST pass `data` as list of dict rows from the SQL tool output, "
            "plus x_field and y_field."
        )

    def get_args_schema(self):
        return ChartArgs

    async def execute(self, context: ToolContext, args: ChartArgs) -> ToolResult:
        chart_payload = _build_chart_payload(args)

        # Validate against this version's ChartComponent
        chart = ChartComponent(**chart_payload)

        return ToolResult(
            success=True,
            result_for_llm="Chart created successfully.",
            ui_component=UiComponent(
                rich_component=chart,
                simple_component=SimpleTextComponent(text="Chart created"),
            ),
        )
