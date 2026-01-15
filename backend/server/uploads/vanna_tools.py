# uploads/vanna_tools.py
from __future__ import annotations

from typing import Any, Dict, List, Optional, get_args

from pydantic import BaseModel, Field

from vanna.core.tool import Tool, ToolContext, ToolResult
from vanna.components import UiComponent, SimpleTextComponent
from vanna.components import ChartComponent


class ChartArgs(BaseModel):
    """Arguments for the `create_custom_chart` tool.

    Notes:
    - `data` must be the SQL rows as list[dict].
    - `spec` is optional; if omitted we generate a simple Plotly-like spec.
    - Different Vanna versions have different ChartComponent schemas; we introspect and adapt.
    """

    data: List[Dict[str, Any]] = Field(..., description="SQL result rows as list of dicts")
    x_field: str = Field(..., description="Key for x axis")
    y_field: str = Field(..., description="Key for y axis")
    chart_type: str = Field("bar", description="bar|line|scatter|pie (depending on supported chart types)")
    title: Optional[str] = Field(None, description="Optional title")
    description: Optional[str] = Field(None, description="Optional description")
    component_type: Optional[str] = Field(
        None,
        description=(
            "Optional ChartComponent.type (varies by Vanna version), e.g. 'plotly', 'chart', 'vega_lite'. "
            "Some versions only allow 'chart'."
        ),
    )
    spec: Optional[Dict[str, Any]] = Field(
        None,
        description=(
            "Optional full chart specification. If omitted, a simple Plotly-like spec is generated from data/x_field/y_field."
        ),
    )

    # Optional Plotly scatter/interaction tuning (used only when we auto-generate spec)
    label_field: Optional[str] = Field(
        None,
        description=(
            "Optional field name used for point labels (maps to Plotly trace 'text'). "
            "Useful for hover/click on scatter charts."
        ),
    )
    scatter_mode: Optional[str] = Field(
        None,
        description=(
            "Optional Plotly scatter mode, e.g. 'markers', 'lines', 'markers+text'. "
            "Used when chart_type='scatter'."
        ),
    )
    marker_size: Optional[int] = Field(
        None,
        ge=1,
        le=200,
        description="Optional Plotly marker size (used when chart_type='scatter').",
    )
    hovertemplate: Optional[str] = Field(
        None,
        description=(
            "Optional Plotly hovertemplate string. Example: '<b>%{text}</b><br>Value: %{y}<extra></extra>'"
        ),
    )
    hovermode: Optional[str] = Field(None, description="Optional Plotly layout.hovermode (e.g. 'closest').")
    clickmode: Optional[str] = Field(
        None, description="Optional Plotly layout.clickmode (e.g. 'event+select')."
    )
    dragmode: Optional[str] = Field(None, description="Optional Plotly layout.dragmode (e.g. 'zoom').")

    # Pie / donut tuning (used only when chart_type='pie' and spec is auto-generated)
    pie_hole: Optional[float] = Field(
        None,
        ge=0,
        le=1,
        description="Optional donut hole size for Plotly pie chart (0..1). Example: 0.4 for donut.",
    )


def _literal_options(annotation) -> List[str]:
    """Extract Literal['a','b'] options if present."""
    try:
        opts = list(get_args(annotation))
        return [o for o in opts if isinstance(o, str)]
    except Exception:
        return []


def _normalize_component_type(v: str) -> str:
    return v.strip().lower().replace("-", "_")


def _pick_supported_type(requested: Optional[str] = None) -> str:
    """Pick a valid value for ChartComponent.type based on its schema."""
    f = getattr(ChartComponent, "model_fields", {}).get("type")
    if not f:
        return "chart"

    # In some versions this is an Enum, not a Literal.
    annotation = getattr(f, "annotation", None)
    opts = _literal_options(annotation)

    # If annotation is Enum, try to read .__members__
    if not opts and hasattr(annotation, "__members__"):
        try:
            opts = [str(v.value) for v in annotation.__members__.values()]
        except Exception:
            opts = []

    # If we still have no options, fallback.
    if not opts:
        return "chart"

    if requested:
        req = _normalize_component_type(requested)
        if req in opts:
            return req
        for o in opts:
            if _normalize_component_type(o) == req:
                return o

    # Prefer common ones
    for preferred in ("chart", "plotly", "vega_lite", "vega", "echarts"):
        if preferred in opts:
            return preferred
    return opts[0]


def _default_spec(args: ChartArgs) -> Dict[str, Any]:
    x = [row.get(args.x_field) for row in args.data]
    y = [row.get(args.y_field) for row in args.data]

    labels = None
    if args.label_field:
        labels = [row.get(args.label_field) for row in args.data]

    # Plotly trace base
    trace: Dict[str, Any]
    if args.chart_type == "pie":
        # Plotly pie expects labels/values (NOT x/y)
        trace = {"type": "pie", "labels": x, "values": y}
        if args.pie_hole is not None:
            trace["hole"] = args.pie_hole
    else:
        trace = {"type": args.chart_type, "x": x, "y": y}

    # If caller wants scatter settings, map args -> Plotly trace keys.
    if args.chart_type == "scatter":
        if args.scatter_mode:
            trace["mode"] = args.scatter_mode
        if args.marker_size is not None:
            trace["marker"] = {"size": args.marker_size}
        if args.hovertemplate:
            trace["hovertemplate"] = args.hovertemplate
        if labels is not None:
            trace["text"] = labels

    layout: Dict[str, Any] = {
        "title": args.title or f"{args.y_field} by {args.x_field}",
    }

    # Axes are not relevant for pie charts
    if args.chart_type != "pie":
        layout["xaxis"] = {"title": args.x_field}
        layout["yaxis"] = {"title": args.y_field}

    # Optional interactivity knobs (only set if provided)
    if args.hovermode:
        layout["hovermode"] = args.hovermode
    if args.clickmode:
        layout["clickmode"] = args.clickmode
    if args.dragmode:
        layout["dragmode"] = args.dragmode

    return {"data": [trace], "layout": layout}


def _build_chart_payload(args: ChartArgs) -> Dict[str, Any]:
    """Build a dict that matches ChartComponent for *this installed version*."""

    fields = getattr(ChartComponent, "model_fields", {})
    payload: Dict[str, Any] = {}

    # Type
    if "type" in fields:
        payload["type"] = _pick_supported_type(args.component_type)

    # Title/description (optional, only if supported)
    if "title" in fields:
        payload["title"] = args.title or f"{args.y_field} by {args.x_field}"

    if "description" in fields and args.description:
        payload["description"] = args.description

    # Chart type (REQUIRED in your current ChartComponent)
    if "chart_type" in fields:
        payload["chart_type"] = args.chart_type

    # Spec vs data/layout differences by version
    spec = args.spec if isinstance(args.spec, dict) else _default_spec(args)

    if "spec" in fields:
        payload["spec"] = spec

    if "data" in fields and "layout" in fields:
        payload["data"] = spec.get("data")
        payload["layout"] = spec.get("layout")

    # IMPORTANT: versions used in this repo require `data` (Dict[str,Any]) and do NOT have `spec`.
    # In that case, put our full spec dict into `data`.
    if "data" in fields and "data" not in payload:
        payload["data"] = spec

    # Engine-like fields (optional)
    for engine_field in ("engine", "renderer", "library"):
        if engine_field in fields:
            annotation = getattr(fields[engine_field], "annotation", None)
            opts = _literal_options(annotation)
            if not opts and hasattr(annotation, "__members__"):
                try:
                    opts = [str(v.value) for v in annotation.__members__.values()]
                except Exception:
                    opts = []

            # Prefer plotly if possible
            if "plotly" in opts:
                payload[engine_field] = "plotly"
            elif opts:
                payload[engine_field] = opts[0]

    return payload


class CustomChartTool(Tool[ChartArgs]):
    @property
    def name(self) -> str:
        return "create_custom_chart"

    @property
    def description(self) -> str:
        return (
            "Create an interactive chart from SQL result rows. "
            "IMPORTANT: pass `data` as list of dict rows from SQL output, plus x_field and y_field. "
            "Optional: chart_type, title, description, component_type, spec."
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
