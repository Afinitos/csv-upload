from django.db import models


class Upload(models.Model):
    workbook = models.CharField(max_length=255)
    mapping = models.JSONField()
    rows = models.JSONField()
    row_count = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]

    def __str__(self) -> str:
        return f"{self.workbook} ({self.row_count} rows) #{self.id}"
