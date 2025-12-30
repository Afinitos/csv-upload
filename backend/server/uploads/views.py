# views.py
from asgiref.sync import async_to_sync
from rest_framework import status, viewsets
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Upload
from .serializers import UploadSerializer
from .vanna_service import VannaServiceError, get_vanna_service


class UploadViewSet(viewsets.ModelViewSet):
    queryset = Upload.objects.all()
    serializer_class = UploadSerializer


def _extract_sql_and_rows(components):
    """
    Pokušaj iz Vanna UI komponenti izvući SQL i tablične redove.
    Shape komponenti zna varirati po verziji, pa je ovo robustno.
    """
    sql = None
    rows = None

    for c in components or []:
        if not isinstance(c, dict):
            continue

        ctype = (c.get("type") or c.get("component_type") or "").lower()

        # SQL block (često "code" ili "sql")
        if sql is None and (ctype in {"sql", "code"} or "sql" in ctype):
            maybe = c.get("sql") or c.get("content") or c.get("text")
            if isinstance(maybe, str) and maybe.strip():
                sql = maybe.strip()

        # Tablica (često "table"/"data_table"/"dataframe")
        if rows is None and (ctype in {"table", "data_table", "dataframe"} or "table" in ctype):
            data = c.get("rows") or c.get("data") or c.get("value")
            if isinstance(data, list):
                rows = data

    return sql, rows


@api_view(["POST"])
def ask(request):
    question = request.data.get("question")
    if not question or not isinstance(question, str):
        return Response({"detail": "question is required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        service = get_vanna_service()
        headers = {k: v for k, v in request.headers.items()}
        cookies = request.COOKIES

        answer = async_to_sync(service.ask)(
            question,
            request_headers=headers,
            request_cookies=cookies,
        )

        components = answer.components if hasattr(answer, "components") else answer
        sql, rows = _extract_sql_and_rows(components)

        # fallback ako rows nije došao u komponenti (neke konfiguracije vrate samo summary)
        if rows is None:
            rows = []

        chart = None
        try:
            from .chart_service import generate_chart_spec
            chart = generate_chart_spec(question=question, sql=sql, rows=rows)
        except Exception:
            chart = None

        return Response({"sql": sql, "rows": rows, "chart": chart, "components": components})

    except VannaServiceError as e:
        return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        return Response({"detail": f"Ask failed: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
