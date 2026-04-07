from django.contrib import admin

from .models import QRCode, ScanEvent


@admin.register(QRCode)
class QRCodeAdmin(admin.ModelAdmin):
    list_display = ("short_code", "design", "user", "redirect_url", "is_active", "created_at")
    list_filter = ("is_active", "design")
    search_fields = ("short_code", "content_text", "user__username")
    readonly_fields = ("id", "tracking_link_preview", "created_at", "updated_at")
    fieldsets = (
        (
            "Tracking link",
            {
                "fields": ("short_code", "tracking_link_preview"),
                "description": "Edit <strong>Short code</strong> to change the scan URL. "
                "After changing it, re-download or regenerate QR images if they were generated with the old link.",
            },
        ),
        (
            "Content",
            {
                "fields": ("content_text", "redirect_url", "is_active"),
            },
        ),
        (
            "Appearance",
            {
                "fields": ("design", "module_color", "center_logo", "qr_image"),
            },
        ),
        (
            "Ownership",
            {
                "fields": ("user",),
            },
        ),
        (
            "Meta",
            {
                "fields": ("id", "created_at", "updated_at"),
                "classes": ("collapse",),
            },
        ),
    )

    @admin.display(description="Full tracking URL (preview)")
    def tracking_link_preview(self, obj: QRCode) -> str:
        from django.conf import settings

        if not obj.pk:
            return "Save the QR code first to see the URL."
        base = (getattr(settings, "PUBLIC_BASE_URL", "") or "").strip().rstrip("/")
        path = f"/s/{obj.short_code}/"
        if not base:
            return f"(set PUBLIC_BASE_URL in settings) {path}"
        return f"{base}{path}"


@admin.register(ScanEvent)
class ScanEventAdmin(admin.ModelAdmin):
    list_display = ("qrcode", "ip_address", "country", "city", "created_at")
    list_filter = ("country",)
