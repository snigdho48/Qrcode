from __future__ import annotations

from collections import Counter

from django.db.models import Case, CharField, Count, F, Q, Value, When
from django.db.models.functions import Coalesce, Concat, Trim, TruncDate
from django.utils.dateparse import parse_date


def scan_events_for_user(user):
    from .models import ScanEvent

    return ScanEvent.objects.filter(qrcode__user=user)


def apply_scan_filters(qs, request):
    """Narrow a ScanEvent queryset using query params."""
    qrcode_ids = request.query_params.get("qrcode_ids", "").strip()
    if qrcode_ids:
        parts = [p.strip() for p in qrcode_ids.split(",") if p.strip()]
        if parts:
            qs = qs.filter(qrcode_id__in=parts)

    date_from = request.query_params.get("date_from", "").strip()
    date_to = request.query_params.get("date_to", "").strip()
    df = parse_date(date_from) if date_from else None
    dt = parse_date(date_to) if date_to else None
    if df:
        qs = qs.filter(created_at__date__gte=df)
    if dt:
        qs = qs.filter(created_at__date__lte=dt)

    text_filters = [
        ("country", "country"),
        ("city", "city"),
        ("region", "region"),
        ("os", "os"),
        ("browser", "browser"),
        ("device_type", "device_type"),
    ]
    for field, param in text_filters:
        v = request.query_params.get(param, "").strip()
        if v:
            qs = qs.filter(**{f"{field}__icontains": v})

    return qs


def annotate_visitor_id(qs):
    """
    Fingerprint when present; otherwise IP + browser as a stable fallback (not perfect).
    """
    fallback = Concat(
        Coalesce(F("ip_address"), Value("")),
        Value("|"),
        Coalesce(F("browser"), Value("")),
        output_field=CharField(max_length=512),
    )
    return qs.annotate(
        visitor_id=Case(
            When(Q(device_fingerprint__isnull=True) | Q(device_fingerprint__exact=""), then=fallback),
            default=Trim("device_fingerprint"),
            output_field=CharField(max_length=512),
        )
    )


def unique_visitors_count(qs):
    return annotate_visitor_id(qs).values("visitor_id").distinct().count()


def scans_by_day_series(qs, max_bars: int = 120):
    return list(
        qs.annotate(day=TruncDate("created_at"))
        .values("day")
        .annotate(c=Count("id"))
        .order_by("day")[:max_bars]
    )


def normalize_os_name(name: str | None) -> str:
    n = (name or "").strip().lower()
    if not n:
        return ""
    if "android" in n:
        return "Android"
    if "ios" in n or "iphone" in n or "ipad" in n or "ipod" in n:
        return "iOS"
    if "windows" in n:
        return "Windows"
    if "mac" in n or "os x" in n or "darwin" in n:
        return "macOS"
    if "linux" in n:
        return "Linux"
    if "chrome os" in n or "chromebook" in n:
        return "Chrome OS"
    return (name or "").strip().split(" ")[0].capitalize()


def normalize_browser_name(name: str | None) -> str:
    n = (name or "").strip().lower()
    if not n:
        return ""
    if "edg" in n or "edge" in n:
        return "Edge"
    if "chrome" in n or "crios" in n:
        return "Chrome"
    if "safari" in n and "chrome" not in n and "crios" not in n:
        return "Safari"
    if "firefox" in n or "fxios" in n:
        return "Firefox"
    if "opera" in n or "opr" in n:
        return "Opera"
    if "samsung" in n:
        return "Samsung Internet"
    if "ucbrowser" in n or " uc " in f" {n} ":
        return "UC Browser"
    if "brave" in n:
        return "Brave"
    return (name or "").strip().split(" ")[0].capitalize()


def breakdown_by_field(qs, field: str, limit: int = 15):
    if field in ("os", "browser"):
        values = qs.exclude(**{f"{field}__exact": ""}).values_list(field, flat=True)
        counter: Counter[str] = Counter()
        for raw in values:
            name = normalize_os_name(raw) if field == "os" else normalize_browser_name(raw)
            if name:
                counter[name] += 1
        return [{"name": name, "count": count} for name, count in counter.most_common(limit)]

    rows = (
        qs.exclude(**{f"{field}__exact": ""})
        .values(field)
        .annotate(c=Count("id"))
        .order_by("-c")[:limit]
    )
    return [{"name": row[field] or "—", "count": row["c"]} for row in rows]
