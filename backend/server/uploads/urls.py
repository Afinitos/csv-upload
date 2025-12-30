from rest_framework.routers import SimpleRouter
from django.urls import path, re_path

from .views import UploadViewSet, ask
from .vanna_proxy_views import chat_sse, chat_poll, chat_websocket


class OptionalSlashRouter(SimpleRouter):
    # Accept both `/` and no trailing slash
    trailing_slash = r"/?"


router = OptionalSlashRouter()
router.register(r"uploads", UploadViewSet, basename="upload")

urlpatterns = [
    *router.urls,
    # Accept both /api/ask and /api/ask/
    re_path(r"^ask/?$", ask),

    re_path(r"^vanna/v2/chat_sse/?$", chat_sse),
    re_path(r"^vanna/v2/chat_poll/?$", chat_poll),
    re_path(r"^vanna/v2/chat_websocket/?$", chat_websocket),
]
