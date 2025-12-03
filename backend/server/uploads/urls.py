from rest_framework.routers import SimpleRouter
from .views import UploadViewSet

class OptionalSlashRouter(SimpleRouter):
    # Accept both `/` and no trailing slash
    trailing_slash = r'/?'

router = OptionalSlashRouter()
router.register(r'uploads', UploadViewSet, basename='upload')

urlpatterns = router.urls
