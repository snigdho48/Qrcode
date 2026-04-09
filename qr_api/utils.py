from __future__ import annotations

import base64
import io
import ipaddress
import re
from typing import Any

import qrcode
import requests
from django.http import HttpRequest
from PIL import Image
from qrcode.image.pil import PilImage
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.colormasks import SolidFillColorMask
from qrcode.image.styles.moduledrawers import CircleModuleDrawer
from user_agents import parse

from .models import QRCode

# Geo endpoint: https://get.geojs.io/v1/ip/geo.json — returns ``ip``, ``latitude``, ``longitude`` (strings), etc.
# With ``?ip=<visitor>`` the body is a JSON array of those objects (one per IP). A bare GET returns the *caller's*
# IP (fine in a browser, wrong if called from Django without ``ip`` — we always pass the client IP).
GEOJS_IP_GEO_JSON = "https://get.geojs.io/v1/ip/geo.json"
QR_TARGET_SIZE_PX = 5000


DESIGN_CLASSIC = "classic"
DESIGN_DOTTED_MAROON = "dotted_maroon"
DESIGN_DOTTED_TEAL = "dotted_teal"

_HEX6 = re.compile(r"^#[0-9A-Fa-f]{6}$")


def parse_module_color(hex_color: str) -> tuple[int, int, int]:
    if not _HEX6.match(hex_color or ""):
        raise ValueError("module_color must be #RRGGBB")
    h = hex_color.strip().lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def get_client_ip(request: HttpRequest) -> str | None:
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    xri = request.META.get("HTTP_X_REAL_IP")
    if xri:
        return xri.strip()
    return request.META.get("REMOTE_ADDR")


def parse_user_agent(ua_string: str) -> dict[str, str]:
    ua = parse(ua_string or "")
    device_type = "mobile" if ua.is_mobile else "tablet" if ua.is_tablet else "desktop"
    browser = ua.browser.family or ""
    os_name = ua.os.family or ""
    return {
        "browser": browser.strip(),
        "os": os_name.strip(),
        "device_type": device_type,
    }


def _geojs_float(val: Any) -> float | None:
    if val is None or val == "":
        return None
    if isinstance(val, str) and val.strip().lower() in ("nil", "null", "none"):
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def is_non_public_ip(ip: str | None) -> bool:
    """True for loopback, private LAN (RFC1918), link-local, etc. — not geolocatable by GeoJS."""
    if not ip:
        return True
    host = ip.strip().split("%", 1)[0].strip()
    if host in ("127.0.0.1", "::1"):
        return True
    try:
        addr = ipaddress.ip_address(host)
        return bool(
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_reserved
            or addr.is_multicast
        )
    except ValueError:
        return True


def reverse_geocode_placenames(lat: float, lon: float) -> dict[str, str]:
    """Fill country / region / city from coordinates (OpenStreetMap Nominatim)."""
    from django.conf import settings

    ua = getattr(settings, "NOMINATIM_USER_AGENT", "qr_whatsapp_bot/1.0")
    try:
        r = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={
                "lat": lat,
                "lon": lon,
                "format": "json",
                "addressdetails": 1,
            },
            timeout=8,
            headers={
                "User-Agent": ua,
                "Accept": "application/json",
                "Accept-Language": "en",
            },
        )
        r.raise_for_status()
        data = r.json()
        addr = data.get("address") or {}
        city = (
            addr.get("city")
            or addr.get("town")
            or addr.get("village")
            or addr.get("municipality")
            or addr.get("hamlet")
            or addr.get("suburb")
            or ""
        )
        return {
            "country": (addr.get("country") or "") or "",
            "region": (addr.get("state") or addr.get("region") or addr.get("county") or "") or "",
            "city": city or "",
        }
    except (requests.RequestException, ValueError, TypeError, KeyError):
        return {"country": "", "region": "", "city": ""}


def geolocate_ip(ip: str | None) -> dict[str, Any]:
    """Look up visitor geo via GeoJS ``geo.json`` (``ip``, ``latitude``, ``longitude``, country, city, …).

    Uses :py:data:`GEOJS_IP_GEO_JSON` with ``?ip=<visitor>`` so the JSON matches the documented single-IP object
    shape (GeoJS returns an array with one element when using the ``ip`` query parameter).

    Private LAN IPs (e.g. ``192.168.x.x``) are not looked up: GeoJS returns ``latitude``/``longitude`` as ``nil``
    and no country; use browser GPS + :func:`reverse_geocode_placenames` in the track view instead.

    """
    if not ip or ip in ("127.0.0.1", "::1"):
        return {}
    if is_non_public_ip(ip):
        return {}
    try:
        r = requests.get(
            GEOJS_IP_GEO_JSON,
            params={"ip": ip},
            timeout=6,
            headers={"Accept": "application/json", "User-Agent": "qr-whatsapp-bot/1.0"},
        )
        r.raise_for_status()
        raw = r.json()
        if isinstance(raw, list):
            data = raw[0] if raw else {}
        else:
            data = raw
        if not isinstance(data, dict):
            return {}
        return {
            "country": (data.get("country") or data.get("country_code") or "") or "",
            "region": (data.get("region") or "") or "",
            "city": (data.get("city") or "") or "",
            "latitude": _geojs_float(data.get("latitude")),
            "longitude": _geojs_float(data.get("longitude")),
        }
    except requests.RequestException:
        return {}
    except (ValueError, TypeError, IndexError):
        return {}


def _pil_from_qr_image(img: Any) -> Image.Image:
    if hasattr(img, "get_image"):
        return img.get_image()
    return img


def paste_logo_center(qr_pil: Image.Image, logo_bytes: bytes, size_fraction: float = 0.35) -> Image.Image:
    """Overlay PNG logo in the center; logo pixels (including colors) are unchanged (uses alpha)."""
    logo = Image.open(io.BytesIO(logo_bytes)).convert("RGBA")
    base = qr_pil.convert("RGBA")
    w, h = base.size
    target_w = max(1, int(w * size_fraction))
    ratio = target_w / logo.width
    target_h = max(1, int(logo.height * ratio))
    logo = logo.resize((target_w, target_h), Image.Resampling.LANCZOS)
    x = (w - target_w) // 2
    y = (h - target_h) // 2
    out = base.copy()
    out.paste(logo, (x, y), logo)
    return out


def render_qr_png_bytes(
    url: str,
    design: str,
    module_rgb: tuple[int, int, int],
    logo_bytes: bytes | None = None,
) -> bytes:
    """Render the tracking URL. ``module_rgb`` tints all QR modules. Logo is composited as-is (teal design only)."""
    dotted = design in (DESIGN_DOTTED_MAROON, DESIGN_DOTTED_TEAL)
    ec = (
        qrcode.constants.ERROR_CORRECT_H
        if dotted
        else qrcode.constants.ERROR_CORRECT_M
    )
    qr = qrcode.QRCode(version=None, error_correction=ec, box_size=10, border=4)
    qr.add_data(url)
    qr.make(fit=True)
    module_count_with_border = (qr.modules_count or 0) + (qr.border * 2)
    if module_count_with_border > 0:
        qr.box_size = max(1, QR_TARGET_SIZE_PX // module_count_with_border)

    if design == DESIGN_CLASSIC:
        img = qr.make_image(
            image_factory=PilImage,
            fill_color=module_rgb,
            back_color=(255, 255, 255),
        )
    elif design in (DESIGN_DOTTED_MAROON, DESIGN_DOTTED_TEAL):
        img = qr.make_image(
            image_factory=StyledPilImage,
            module_drawer=CircleModuleDrawer(),
            color_mask=SolidFillColorMask(
                back_color=(255, 255, 255),
                front_color=module_rgb,
            ),
        )
    else:
        img = qr.make_image(
            image_factory=PilImage,
            fill_color=module_rgb,
            back_color=(255, 255, 255),
        )

    pil_img = _pil_from_qr_image(img)

    if pil_img.size != (QR_TARGET_SIZE_PX, QR_TARGET_SIZE_PX):
        # Keep edges crisp for scanners; avoid blur from anti-aliased scaling.
        pil_img = pil_img.resize((QR_TARGET_SIZE_PX, QR_TARGET_SIZE_PX), Image.Resampling.NEAREST)

    if design == DESIGN_DOTTED_TEAL and logo_bytes:
        pil_img = paste_logo_center(pil_img, logo_bytes)

    buf = io.BytesIO()
    if pil_img.mode == "RGBA":
        pil_img.save(buf, format="PNG")
    else:
        pil_img.save(buf, format="PNG")
    return buf.getvalue()


def build_qr_png_base64(
    url: str,
    design: str,
    module_rgb: tuple[int, int, int],
    logo_bytes: bytes | None = None,
) -> str:
    raw = render_qr_png_bytes(url, design, module_rgb, logo_bytes)
    return base64.b64encode(raw).decode("ascii")


def generate_qr_image_file(qr: QRCode) -> None:
    """Save a high-resolution (5000x5000) PNG of the tracking link to ``qr.qr_image``."""
    from django.conf import settings
    from django.core.files.base import ContentFile

    if qr.qr_image:
        return
    public = getattr(settings, "PUBLIC_BASE_URL", "").strip().rstrip("/")
    if not public:
        return
    url = f"{public}/s/{qr.short_code}/"
    module_rgb = parse_module_color(qr.module_color)
    logo_bytes = None
    if qr.design == QRCode.Design.DOTTED_TEAL and qr.center_logo:
        with qr.center_logo.open("rb") as f:
            logo_bytes = f.read()
    raw = render_qr_png_bytes(url, qr.design, module_rgb, logo_bytes)
    buf = io.BytesIO(raw)
    qr.qr_image.save(f"{qr.short_code}.png", ContentFile(buf.read()), save=True)


def regenerate_qr_image_file(qr: QRCode) -> None:
    """Replace stored PNG after design/color/logo change (when media upload is enabled)."""
    if qr.qr_image:
        qr.qr_image.delete(save=False)
        qr.qr_image = None
        qr.save(update_fields=["qr_image"])
    generate_qr_image_file(qr)
