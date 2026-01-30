# views.py
import time

from asgiref.sync import async_to_sync
from rest_framework import status, viewsets
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Upload
from .serializers import UploadSerializer, UploadCreateResponseSerializer, UploadListSerializer
from .vanna_service import VannaServiceError, get_vanna_service


class UploadViewSet(viewsets.ModelViewSet):
    queryset = Upload.objects.all()
    serializer_class = UploadSerializer

    def get_serializer_class(self):
        # Listing uploads should be light: don't ship 10k rows for each upload.
        if self.action == "list":
            return UploadListSerializer

        # For create, accept full payload but respond with metadata only.
        if self.action == "create":
            return UploadSerializer

        return UploadSerializer

    def create(self, request, *args, **kwargs):
        t0 = time.perf_counter()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # rows can be huge; log just metadata
        try:
            workbook = serializer.validated_data.get("workbook")
            rows_len = len(serializer.validated_data.get("rows") or [])
        except Exception:
            workbook = None
            rows_len = None

        t_valid = time.perf_counter()
        self.perform_create(serializer)
        t_saved = time.perf_counter()

        # Respond without `rows` payload
        out = UploadCreateResponseSerializer(serializer.instance)
        headers = self.get_success_headers(out.data)
        resp = Response(out.data, status=status.HTTP_201_CREATED, headers=headers)

        # Basic performance metrics for debugging large uploads
        try:
            resp["X-Upload-Validate-ms"] = f"{(t_valid - t0) * 1000:.2f}"
            resp["X-Upload-Save-ms"] = f"{(t_saved - t_valid) * 1000:.2f}"
            resp["X-Upload-Total-ms"] = f"{(t_saved - t0) * 1000:.2f}"
            resp["X-Upload-Rows"] = str(rows_len if rows_len is not None else "")
            resp["X-Upload-Workbook"] = str(workbook if workbook is not None else "")
        except Exception:
            pass

        return resp

    def list(self, request, *args, **kwargs):
        """Lightweight list with optional workbook filter + X-Total-Count.

        Frontend uses limit/offset for pagination and reads X-Total-Count.
        """

        t0 = time.perf_counter()
        qs = self.filter_queryset(self.get_queryset())

        workbook = request.query_params.get("workbook")
        if workbook:
            qs = qs.filter(workbook=workbook)

        total = qs.count()

        # crude limit/offset pagination (keeps deps minimal)
        try:
            limit = int(request.query_params.get("limit", 50))
        except Exception:
            limit = 50
        try:
            offset = int(request.query_params.get("offset", 0))
        except Exception:
            offset = 0

        limit = max(1, min(limit, 500))
        offset = max(0, offset)

        items = qs[offset : offset + limit]
        serializer = UploadListSerializer(items, many=True)
        resp = Response(serializer.data)
        resp["X-Total-Count"] = str(total)
        try:
            resp["X-List-Total-ms"] = f"{(time.perf_counter() - t0) * 1000:.2f}"
        except Exception:
            pass
        return resp


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
