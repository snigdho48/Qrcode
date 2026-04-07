import base64
import re

from django.contrib.auth.models import User
from rest_framework import serializers

from .models import QRCode, ScanEvent

_HEX6 = re.compile(r"^#[0-9A-Fa-f]{6}$")


class UserRegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ("id", "username", "email", "password")
        extra_kwargs = {"email": {"required": False, "allow_blank": True}}

    def create(self, validated_data):
        return User.objects.create_user(
            username=validated_data["username"],
            email=validated_data.get("email", ""),
            password=validated_data["password"],
        )


class QRCodeSerializer(serializers.ModelSerializer):
    scan_url = serializers.SerializerMethodField()
    qr_image_url = serializers.SerializerMethodField()
    qr_image_base64 = serializers.SerializerMethodField()
    center_logo_url = serializers.SerializerMethodField()

    class Meta:
        model = QRCode
        fields = (
            "id",
            "design",
            "module_color",
            "center_logo_url",
            "content_text",
            "redirect_url",
            "scan_url",
            "qr_image_url",
            "qr_image_base64",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "design",
            "module_color",
            "scan_url",
            "qr_image_url",
            "qr_image_base64",
            "center_logo_url",
            "created_at",
            "updated_at",
        )

    def get_scan_url(self, obj: QRCode) -> str:
        from django.conf import settings

        request = self.context.get("request")
        public = getattr(settings, "PUBLIC_BASE_URL", "").rstrip("/")
        if public:
            return f"{public}/s/{obj.short_code}/"
        if request:
            return request.build_absolute_uri(f"/s/{obj.short_code}/")
        return f"/s/{obj.short_code}/"

    def get_qr_image_url(self, obj: QRCode) -> str | None:
        if not obj.qr_image:
            return None
        request = self.context.get("request")
        url = obj.qr_image.url
        if request:
            return request.build_absolute_uri(url)
        return url

    def get_center_logo_url(self, obj: QRCode) -> str | None:
        if not obj.center_logo:
            return None
        request = self.context.get("request")
        url = obj.center_logo.url
        if request:
            return request.build_absolute_uri(url)
        return url

    def get_qr_image_base64(self, obj: QRCode) -> str:
        from .utils import build_qr_png_base64, parse_module_color

        if obj.qr_image:
            with obj.qr_image.open("rb") as f:
                return base64.b64encode(f.read()).decode("ascii")
        url = self.get_scan_url(obj)
        module_rgb = parse_module_color(obj.module_color)
        logo_bytes = None
        if obj.design == QRCode.Design.DOTTED_TEAL and obj.center_logo:
            with obj.center_logo.open("rb") as f:
                logo_bytes = f.read()
        return build_qr_png_base64(url, obj.design, module_rgb, logo_bytes)


class QRCodeWriteSerializer(serializers.ModelSerializer):
    center_logo = serializers.ImageField(required=False, allow_null=True)

    class Meta:
        model = QRCode
        fields = ("content_text", "redirect_url", "design", "module_color", "center_logo")
        extra_kwargs = {
            "content_text": {"required": False},
            "redirect_url": {"required": False},
            "design": {"required": False},
            "module_color": {"required": False},
        }

    def validate_module_color(self, value: str) -> str:
        if not _HEX6.match(value or ""):
            raise serializers.ValidationError("Use #RRGGBB (e.g. #1a1a1a).")
        return value.upper()

    def validate_center_logo(self, value):
        if not value:
            return value
        name = getattr(value, "name", "") or ""
        if not name.lower().endswith(".png"):
            raise serializers.ValidationError("Upload a PNG file.")
        return value

    def validate(self, attrs):
        instance = self.instance
        if instance is None:
            design = attrs.get("design", QRCode.Design.CLASSIC)
            if design == QRCode.Design.DOTTED_TEAL and not attrs.get("center_logo"):
                raise serializers.ValidationError(
                    {"center_logo": "PNG logo is required for Teal dots design."}
                )
            return attrs

        design = attrs.get("design", instance.design)
        new_logo = attrs.get("center_logo") if "center_logo" in attrs else None
        existing_logo = instance.center_logo
        if design == QRCode.Design.DOTTED_TEAL and not new_logo and not existing_logo:
            raise serializers.ValidationError(
                {"center_logo": "PNG logo is required for Teal dots design."}
            )
        return attrs

    def create(self, validated_data):
        validated_data["user"] = self.context["request"].user
        if "module_color" not in validated_data or not validated_data["module_color"]:
            validated_data["module_color"] = "#000000"
        return super().create(validated_data)

    def update(self, instance: QRCode, validated_data):
        new_design = validated_data.get("design", instance.design)
        if new_design != QRCode.Design.DOTTED_TEAL:
            if instance.center_logo:
                instance.center_logo.delete(save=False)
            validated_data["center_logo"] = None
        return super().update(instance, validated_data)


class ScanEventSerializer(serializers.ModelSerializer):
    qrcode_text = serializers.CharField(source="qrcode.content_text", read_only=True)

    class Meta:
        model = ScanEvent
        fields = (
            "id",
            "qrcode_text",
            "ip_address",
            "country",
            "city",
            "region",
            "latitude",
            "longitude",
            "browser",
            "os",
            "device_type",
            "device_fingerprint",
            "client_meta",
            "user_agent_raw",
            "created_at",
        )


class TrackPayloadSerializer(serializers.Serializer):
    device_fingerprint = serializers.CharField(required=False, allow_blank=True, max_length=256)
    client_meta = serializers.JSONField(required=False, default=dict)
    latitude = serializers.FloatField(required=False, allow_null=True, min_value=-90, max_value=90)
    longitude = serializers.FloatField(required=False, allow_null=True, min_value=-180, max_value=180)
    geojs_ip = serializers.CharField(required=False, allow_blank=True, max_length=64)
    geojs_country = serializers.CharField(required=False, allow_blank=True, max_length=128)
    geojs_city = serializers.CharField(required=False, allow_blank=True, max_length=128)
    geojs_region = serializers.CharField(required=False, allow_blank=True, max_length=128)
    geojs_latitude = serializers.FloatField(required=False, allow_null=True, min_value=-90, max_value=90)
    geojs_longitude = serializers.FloatField(required=False, allow_null=True, min_value=-180, max_value=180)

    def validate(self, attrs):
        lat = attrs.get("latitude")
        lon = attrs.get("longitude")
        if (lat is not None) ^ (lon is not None):
            raise serializers.ValidationError(
                "latitude and longitude must both be provided for a GPS fix, or both omitted."
            )
        glat = attrs.get("geojs_latitude")
        glon = attrs.get("geojs_longitude")
        if (glat is not None) ^ (glon is not None):
            raise serializers.ValidationError(
                "geojs_latitude and geojs_longitude must both be provided, or both omitted."
            )
        return attrs
