from django.contrib import admin
from .models import Upload


@admin.register(Upload)
class UploadAdmin(admin.ModelAdmin):
    list_display = ("id", "workbook", "row_count", "created_at")
    list_filter = ("workbook", "created_at")
    search_fields = ("workbook",)
    ordering = ("-id",)
