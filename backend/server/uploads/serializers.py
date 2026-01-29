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


class UploadListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for listing uploads.

    Returning the entire `rows` JSON for every upload becomes extremely heavy
    once a single upload contains thousands of rows.
    """

    class Meta:
        model = Upload
        fields = ["id", "workbook", "mapping", "row_count", "created_at"]


class UploadCreateResponseSerializer(serializers.ModelSerializer):
    """Response serializer for create().

    The client already knows the posted `rows`; returning them again bloats the response.
    """

    class Meta:
        model = Upload
        fields = ["id", "workbook", "mapping", "row_count", "created_at"]
