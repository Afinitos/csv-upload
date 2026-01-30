from rest_framework import serializers
from .models import Upload


class UploadSerializer(serializers.ModelSerializer):
    class Meta:
        model = Upload
        fields = ["id", "workbook", "rows", "mapping", "row_count", "created_at"]
        read_only_fields = ["id", "row_count", "created_at"]

    def validate(self, attrs):
        # Ensure row_count matches rows length if provided by client; otherwise compute
        rows = attrs.get("rows")
        if rows is not None:
            attrs["row_count"] = len(rows)
        return attrs
