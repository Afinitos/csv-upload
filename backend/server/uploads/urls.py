from rest_framework.routers import SimpleRouter
from django.urls import path, re_path

from .views import UploadViewSet, ask


class OptionalSlashRouter(SimpleRouter):
    # Accept both `/` and no trailing slash
    trailing_slash = r"/?"


router = OptionalSlashRouter()
router.register(r"uploads", UploadViewSet, basename="upload")

urlpatterns = [
    *router.urls,
    # Accept both /api/ask and /api/ask/
    re_path(r"^ask/?$", ask),
]
