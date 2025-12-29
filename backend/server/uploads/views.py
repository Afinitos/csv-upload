from rest_framework import viewsets, permissions, status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Upload
from .serializers import UploadSerializer
from .vanna_service import VannaServiceError, get_vanna_service


class UploadViewSet(viewsets.ModelViewSet):
    queryset = Upload.objects.all().order_by("-id")
    serializer_class = UploadSerializer
    permission_classes = [permissions.AllowAny]


@api_view(["POST"])
def ask(request):
    """Ask natural language question about the Postgres DB.

    Body:
    {
      "question": "How many uploads are there?"
    }

    Response:
    {
      "sql": "SELECT ...",
      "rows": [ { ... }, ... ]
    }
    """

    question = request.data.get("question")
    max_rows = request.data.get("max_rows", 200)

    try:
        if not question or not isinstance(question, str):
            return Response({"detail": "question is required"}, status=status.HTTP_400_BAD_REQUEST)

        service = get_vanna_service()
        sql, rows = service.ask(question, max_rows=int(max_rows))
        return Response({"sql": sql, "rows": rows})
    except VannaServiceError as e:
        return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        # Common case: OpenAI quota / billing
        if "insufficient_quota" in str(e) or "RateLimitError" in str(type(e)):
            return Response(
                {"detail": "OpenAI quota exceeded / billing not enabled for this API key."},
                status=status.HTTP_402_PAYMENT_REQUIRED,
            )

        return Response({"detail": f"Ask failed: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
