import secrets
import uuid

from django.conf import settings
from django.db import models


def _short_code() -> str:
    return secrets.token_urlsafe(9)[:12].replace("-", "x")


class QRCode(models.Model):
    class Design(models.TextChoices):
        CLASSIC = "classic", "Classic (black & white)"
        DOTTED_MAROON = "dotted_maroon", "Dotted (maroon)"
        DOTTED_TEAL = "dotted_teal", "Dotted (teal)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    short_code = models.SlugField(
        max_length=16,
        unique=True,
        db_index=True,
        help_text=(
            "Tracking link path: your site serves /s/<this value>/ "
            "(letters, numbers, hyphens, underscores). Change in admin to customize the URL; must stay unique."
        ),
    )
    design = models.CharField(
        max_length=32,
        choices=Design.choices,
        default=Design.CLASSIC,
        db_index=True,
    )
    content_text = models.TextField(help_text="Stored label or payload for this QR.")
    redirect_url = models.URLField(
        max_length=2048,
        default="https://www.google.com",
        help_text="Final URL opened after the tracking page records the scan.",
    )
    module_color = models.CharField(
        max_length=7,
        default="#000000",
        help_text="Hex color (#RRGGBB) for QR modules only; center logo keeps its own colors.",
    )
    center_logo = models.ImageField(
        upload_to="qr_logos/%Y/%m/",
        blank=True,
        help_text="PNG logo for Teal dots design (center overlay).",
    )
    qr_image = models.ImageField(upload_to="qr_codes/%Y/%m/", blank=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="qrcodes",
    )
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.short_code:
            for _ in range(20):
                code = _short_code()
                if not QRCode.objects.filter(short_code=code).exists():
                    self.short_code = code
                    break
            else:
                raise RuntimeError("Could not allocate short_code")
        super().save(*args, **kwargs)


class ScanEvent(models.Model):
    qrcode = models.ForeignKey(
        QRCode,
        on_delete=models.CASCADE,
        related_name="scans",
    )
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    country = models.CharField(max_length=128, blank=True)
    city = models.CharField(max_length=128, blank=True)
    region = models.CharField(max_length=128, blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    user_agent_raw = models.TextField(blank=True)
    browser = models.CharField(max_length=128, blank=True)
    os = models.CharField(max_length=128, blank=True)
    device_type = models.CharField(max_length=64, blank=True)
    device_fingerprint = models.CharField(max_length=256, blank=True)
    client_meta = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
