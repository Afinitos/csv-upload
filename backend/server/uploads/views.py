from rest_framework import viewsets, permissions
from .models import Upload
from .serializers import UploadSerializer


class UploadViewSet(viewsets.ModelViewSet):
    queryset = Upload.objects.all().order_by("-id")
    serializer_class = UploadSerializer
    permission_classes = [permissions.AllowAny]
