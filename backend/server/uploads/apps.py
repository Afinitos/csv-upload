# uploads/apps.py
import os
from django.apps import AppConfig


class UploadsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "uploads"

    def ready(self):
        # Django runserver autoreload pokreće app dvaput.
        # RUN_MAIN= true označava "glavni" proces.
        if os.environ.get("RUN_MAIN") == "true":
            from .vanna_fastapi_server import start_vanna_fastapi_server
            start_vanna_fastapi_server()