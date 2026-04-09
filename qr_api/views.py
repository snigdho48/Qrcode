from datetime import timedelta
import json

from django.conf import settings
from django.contrib.auth.models import User
from django.core.paginator import Paginator
from django.db.models import Count, Max, Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .analytics_utils import (
    apply_scan_filters,
    breakdown_by_field,
    normalize_browser_name,
    normalize_os_name,
    scan_events_for_user,
    scans_by_day_series,
    unique_visitors_count,
)
from .models import QRCode, ScanEvent
from .serializers import (
    QRCodeSerializer,
    QRCodeWriteSerializer,
    ScanEventSerializer,
    UserRegisterSerializer,
)
from .whatsapp import (
    configured_destination_number,
    extract_prefilled_text,
    extract_whatsapp_number,
    send_main_menu,
    send_skin_list,
    send_text,
    whatsapp_enabled,
)


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        ser = UserRegisterSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        if User.objects.filter(username=ser.validated_data["username"]).exists():
            return Response(
                {"detail": "Username already taken."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = ser.save()
        return Response({"id": user.id, "username": user.username}, status=status.HTTP_201_CREATED)


class QRCodeListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request):
        qs = QRCode.objects.filter(user=request.user).order_by("-created_at")
        search = request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(Q(content_text__icontains=search) | Q(redirect_url__icontains=search))

        try:
            page_size = int(request.query_params.get("page_size", 10))
        except ValueError:
            page_size = 10
        page_size = max(1, min(page_size, 100))

        try:
            page = int(request.query_params.get("page", 1))
        except ValueError:
            page = 1
        page = max(1, page)

        paginator = Paginator(qs, page_size)
        page_obj = paginator.get_page(page)
        ser = QRCodeSerializer(page_obj.object_list, many=True, context={"request": request})
        return Response(
            {
                "count": paginator.count,
                "page": page_obj.number,
                "page_size": page_size,
                "total_pages": paginator.num_pages,
                "results": ser.data,
            }
        )

    def post(self, request):
        ser = QRCodeWriteSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        qr = ser.save()
        from .utils import generate_qr_image_file

        generate_qr_image_file(qr)
        qr.refresh_from_db()
        return Response(
            QRCodeSerializer(qr, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class QRCodeDetailView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_object(self, request, pk):
        return get_object_or_404(QRCode, pk=pk, user=request.user)

    def get(self, request, pk):
        qr = self.get_object(request, pk)
        return Response(QRCodeSerializer(qr, context={"request": request}).data)

    def patch(self, request, pk):
        qr = self.get_object(request, pk)
        snap = {
            "design": qr.design,
            "module_color": qr.module_color,
            "logo_name": qr.center_logo.name if qr.center_logo else "",
        }
        ser = QRCodeWriteSerializer(qr, data=request.data, partial=True, context={"request": request})
        ser.is_valid(raise_exception=True)
        qr = ser.save()
        qr.refresh_from_db()
        need_regen = (
            snap["design"] != qr.design
            or snap["module_color"] != qr.module_color
            or snap["logo_name"] != (qr.center_logo.name if qr.center_logo else "")
        )
        if need_regen:
            from .utils import regenerate_qr_image_file

            regenerate_qr_image_file(qr)
            qr.refresh_from_db()
        return Response(QRCodeSerializer(qr, context={"request": request}).data)

    def delete(self, request, pk):
        qr = self.get_object(request, pk)
        qr.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class QRCodeScansView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        qr = get_object_or_404(QRCode, pk=pk, user=request.user)
        scans = qr.scans.all()[:200]
        return Response(ScanEventSerializer(scans, many=True).data)


class AnalyticsSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        total_qr = QRCode.objects.filter(user=user).count()
        base = scan_events_for_user(user)
        total_scans = base.count()
        unique_visitors = unique_visitors_count(base)
        cut = timezone.now().date() - timedelta(days=29)
        chart_qs = base.filter(created_at__date__gte=cut)
        by_day_rows = scans_by_day_series(chart_qs, max_bars=31)
        recent = base.select_related("qrcode").order_by("-created_at")[:25]
        return Response(
            {
                "total_qrcodes": total_qr,
                "total_scans": total_scans,
                "unique_visitors": unique_visitors,
                "scans_by_day": [
                    {"date": row["day"].isoformat() if row["day"] else None, "count": row["c"]}
                    for row in by_day_rows
                ],
                "recent_scans": ScanEventSerializer(recent, many=True).data,
            }
        )


class AnalyticsReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = apply_scan_filters(scan_events_for_user(request.user), request)
        total_scans = qs.count()
        unique_visitors = unique_visitors_count(qs)
        by_day_rows = scans_by_day_series(qs, max_bars=120)
        map_points = list(
            qs.exclude(latitude__isnull=True)
            .exclude(longitude__isnull=True)
            .values("latitude", "longitude")
            .annotate(
                scans=Count("id"),
                created_at=Max("created_at"),
                city=Max("city"),
                country=Max("country"),
            )
            .order_by("-scans", "-created_at")[:2000]
        )
        try:
            page_size = int(request.query_params.get("page_size", 10))
        except ValueError:
            page_size = 10
        page_size = max(1, min(page_size, 100))
        try:
            page = int(request.query_params.get("page", 1))
        except ValueError:
            page = 1
        page = max(1, page)
        paginator = Paginator(qs.select_related("qrcode").order_by("-created_at"), page_size)
        page_obj = paginator.get_page(page)
        recent_rows = ScanEventSerializer(page_obj.object_list, many=True).data
        for row in recent_rows:
            row["os"] = normalize_os_name(row.get("os", ""))
            row["browser"] = normalize_browser_name(row.get("browser", ""))
        return Response(
            {
                "total_scans": total_scans,
                "unique_visitors": unique_visitors,
                "scans_by_day": [
                    {"date": row["day"].isoformat() if row["day"] else None, "count": row["c"]}
                    for row in by_day_rows
                ],
                "by_os": breakdown_by_field(qs, "os"),
                "by_device_type": breakdown_by_field(qs, "device_type"),
                "by_browser": breakdown_by_field(qs, "browser"),
                "map_points": map_points,
                "recent_scans": recent_rows,
                "page": page_obj.number,
                "page_size": page_size,
                "total_pages": paginator.num_pages,
                "count": paginator.count,
            }
        )


class AnalyticsMetaView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        base = scan_events_for_user(request.user)

        def distinct_list(field: str, limit: int = 150):
            return list(
                base.exclude(**{f"{field}__exact": ""})
                .values_list(field, flat=True)
                .distinct()
                .order_by(field)[:limit]
            )

        return Response(
            {
                "countries": distinct_list("country"),
                "cities": distinct_list("city"),
                "regions": distinct_list("region"),
                "os_list": distinct_list("os"),
                "browsers": distinct_list("browser"),
                "device_types": distinct_list("device_type"),
            }
        )


class QRCodeOptionsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        rows = (
            QRCode.objects.filter(user=request.user)
            .order_by("-created_at")
            .values("id", "short_code", "content_text")[:500]
        )
        return Response({"results": list(rows)})


@api_view(["GET"])
@permission_classes([AllowAny])
def scan_landing(request, short_code):
    import json
    from html import escape
    from urllib.parse import quote

    from django.conf import settings
    from django.http import HttpResponse

    qr = get_object_or_404(QRCode, short_code=short_code)
    if not qr.is_active:
        return HttpResponse(
            """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Unavailable</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;max-width:28rem;margin:auto;text-align:center;color:#333;">
<p style="font-size:1.125rem;">This QR code is no longer active.</p>
<p style="font-size:0.875rem;color:#666;">Scans are disabled for this link.</p>
</body></html>""",
            status=410,
            content_type="text/html; charset=utf-8",
        )
    api_base = getattr(settings, "PUBLIC_BASE_URL", "").rstrip("/") or ""
    if not api_base:
        api_base = request.build_absolute_uri("/").rstrip("/")
    track_url = f"{api_base}/api/track/{short_code}/"
    redirect_to = qr.redirect_url
    # Different approach: if QR redirect is a WhatsApp deep link, proactively send menu to that destination
    # and redirect user to configured bot chat number (if provided) so conversation starts in bot thread.
    if whatsapp_enabled():
        wa_dest = extract_whatsapp_number(redirect_to)
        if wa_dest:
            r = send_main_menu(wa_dest)
            if not r.get("ok"):
                print("scan_landing_whatsapp_menu_failed:", r)
            bot_chat = "".join(ch for ch in getattr(settings, "WHATSAPP_CLICK_TO_CHAT_NUMBER", "") if ch.isdigit())
            if bot_chat:
                text = extract_prefilled_text(redirect_to) or "Hi"
                redirect_to = f"https://wa.me/{bot_chat}?text={quote(text)}"
    redirect_js = json.dumps(redirect_to)
    redirect_meta = escape(redirect_to, quote=True)
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Redirecting</title></head>
<body>
<script>
(async function() {{
  function fp() {{
    try {{
      const c = document.createElement("canvas");
      const x = c.getContext("2d");
      x.textBaseline = "top";
      x.font = "14px Arial";
      x.fillText("qr", 2, 2);
      const raw = [
        navigator.userAgent,
        navigator.language,
        screen.width + "x" + screen.height,
        new Intl.DateTimeFormat().resolvedOptions().timeZone,
        navigator.hardwareConcurrency || "",
        navigator.platform || "",
        c.toDataURL(),
      ].join("|");
      let h = 0;
      for (let i = 0; i < raw.length; i++) h = ((h << 5) - h) + raw.charCodeAt(i) | 0;
      return "fp_" + (h >>> 0).toString(16);
    }} catch (e) {{ return "fp_err"; }}
  }}
  const client_meta = {{
    ua: navigator.userAgent,
    language: navigator.language,
    languages: navigator.languages || [],
    platform: navigator.platform,
    screen: {{ w: screen.width, h: screen.height }},
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    touchPoints: navigator.maxTouchPoints,
  }};
  const gps = await new Promise((resolve) => {{
    if (!navigator.geolocation) {{
      resolve(null);
      return;
    }}
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({{ lat: p.coords.latitude, lon: p.coords.longitude }}),
      () => resolve(null),
      {{ enableHighAccuracy: false, timeout: 5000, maximumAge: 120000 }}
    );
  }});
  let geojs = null;
  try {{
    const g = await fetch("https://get.geojs.io/v1/ip/geo.json", {{ cache: "no-store" }});
    if (g.ok) geojs = await g.json();
  }} catch (e) {{}}
  const trackBody = {{ device_fingerprint: fp(), client_meta: client_meta }};
  if (gps) {{
    trackBody.latitude = gps.lat;
    trackBody.longitude = gps.lon;
  }}
  if (geojs && typeof geojs === "object" && !Array.isArray(geojs)) {{
    const f = (v) => {{
      if (v === null || v === undefined) return null;
      const s = String(v).trim().toLowerCase();
      if (!s || s === "nil" || s === "null" || s === "none") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }};
    trackBody.geojs_ip = geojs.ip || "";
    trackBody.geojs_country = geojs.country || geojs.country_code || "";
    trackBody.geojs_city = geojs.city || "";
    trackBody.geojs_region = geojs.region || "";
    const glat = f(geojs.latitude);
    const glon = f(geojs.longitude);
    if (glat !== null && glon !== null) {{
      trackBody.geojs_latitude = glat;
      trackBody.geojs_longitude = glon;
    }}
    trackBody.client_meta.geojs_raw = geojs;
  }}
  try {{
    await fetch("{track_url}", {{
      method: "POST",
      headers: {{ "Content-Type": "application/json" }},
      body: JSON.stringify(trackBody)
    }});
  }} catch (e) {{}}
  window.location.replace({redirect_js});
}})();
</script>
<noscript><meta http-equiv="refresh" content="0;url={redirect_meta}"/></noscript>
</body></html>"""
    return HttpResponse(html)


@api_view(["POST"])
@permission_classes([AllowAny])
def track_scan(request, short_code):
    from .serializers import TrackPayloadSerializer
    from .utils import (
        get_client_ip,
        parse_user_agent,
        reverse_geocode_placenames,
    )

    qr = get_object_or_404(QRCode, short_code=short_code)
    if not qr.is_active:
        return Response(
            {"detail": "This QR code is inactive."},
            status=status.HTTP_410_GONE,
        )
    ser = TrackPayloadSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    ip = get_client_ip(request)
    ua_raw = request.META.get("HTTP_USER_AGENT", "")
    parsed = parse_user_agent(ua_raw)
    geojs_ip = (ser.validated_data.get("geojs_ip") or "").strip()
    if geojs_ip:
        ip = geojs_ip
    geo = {
        "country": (ser.validated_data.get("geojs_country") or "").strip(),
        "city": (ser.validated_data.get("geojs_city") or "").strip(),
        "region": (ser.validated_data.get("geojs_region") or "").strip(),
        "latitude": ser.validated_data.get("geojs_latitude"),
        "longitude": ser.validated_data.get("geojs_longitude"),
    }
    client_lat = ser.validated_data.get("latitude")
    client_lon = ser.validated_data.get("longitude")
    if client_lat is not None and client_lon is not None:
        lat, lon = client_lat, client_lon
    else:
        lat, lon = geo.get("latitude"), geo.get("longitude")
    country = geo.get("country", "") or ""
    city = geo.get("city", "") or ""
    region = geo.get("region", "") or ""
    if lat is not None and lon is not None and not (country or city or region):
        rev = reverse_geocode_placenames(float(lat), float(lon))
        country = country or rev.get("country", "")
        city = city or rev.get("city", "")
        region = region or rev.get("region", "")
    ScanEvent.objects.create(
        qrcode=qr,
        ip_address=ip,
        country=country,
        city=city,
        region=region,
        latitude=lat,
        longitude=lon,
        user_agent_raw=ua_raw,
        browser=parsed["browser"],
        os=parsed["os"],
        device_type=parsed["device_type"],
        device_fingerprint=ser.validated_data.get("device_fingerprint") or "",
        client_meta=ser.validated_data.get("client_meta") or {},
    )
    return Response({"ok": True})


@csrf_exempt
def whatsapp_webhook(request):
    def _handle_text_choice(user: str, text: str) -> bool:
        t = (text or "").strip().lower()
        if not t:
            return False
        if t in {"1", "product", "product for you", "menu"}:
            r = send_skin_list(user)
            _report(r, "text_product_to_skin_list")
            if not r.get("ok"):
                _report(
                    send_text(user, "Skin issues: acne, dark, pigment, dry. Reply with one keyword."),
                    "text_product_to_skin_list_fallback",
                )
            return True
        if t in {"2", "consult", "consultation"}:
            _report(send_text(user, "Our expert will contact you soon."), "text_consult")
            return True
        if t in {"3", "info", "all you need"}:
            _report(send_text(user, "Visit our website: https://qr.niayouthfulglow.com"), "text_info")
            return True
        if t in {"acne", "dry", "dark", "pigment"}:
            if t == "acne":
                _report(send_text(user, "For acne-prone skin: use salicylic acid and keep skin hydrated."), "text_acne")
            elif t == "dark":
                _report(
                    send_text(user, "For dark circles: use caffeine eye serum and maintain regular sleep."),
                    "text_dark",
                )
            elif t == "pigment":
                _report(send_text(user, "For pigmentation: use vitamin C in daytime and sunscreen daily."), "text_pigment")
            elif t == "dry":
                _report(send_text(user, "For dry skin: use ceramide moisturizer and gentle cleanser."), "text_dry")
            return True
        return False

    def _report(result: dict, label: str) -> None:
        if result.get("ok"):
            return
        print(f"whatsapp_send_failed[{label}]:", result)

    if request.method == "GET":
        from django.http import HttpResponse as RawResponse

        verify_token = request.GET.get("hub.verify_token")
        challenge = request.GET.get("hub.challenge")
        if verify_token and verify_token == settings.WHATSAPP_VERIFY_TOKEN:
            return RawResponse(challenge, content_type="text/plain", status=200)
        return RawResponse("Invalid token", content_type="text/plain", status=403)

    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    try:
        payload = json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"status": "ok"}, status=200)

    try:
        value = payload.get("entry", [])[0].get("changes", [])[0].get("value", {})
        messages = value.get("messages") or []
        if not messages:
            return JsonResponse({"status": "ok"}, status=200)

        msg = messages[0]
        user = msg.get("from")
        if settings.WHATSAPP_FORCE_DESTINATION_RECIPIENT:
            forced_to = configured_destination_number()
            if forced_to:
                user = forced_to
        if not user or not whatsapp_enabled():
            return JsonResponse({"status": "ok"}, status=200)

        if msg.get("type") == "text":
            txt = (msg.get("text") or {}).get("body", "")
            if not _handle_text_choice(user, txt):
                r = send_main_menu(user)
                _report(r, "main_menu")
                if not r.get("ok"):
                    _report(send_text(user, "Reply with: 1) Product  2) Consultation  3) Info"), "main_menu_fallback")
            return JsonResponse({"status": "ok"}, status=200)

        if msg.get("type") != "interactive":
            return JsonResponse({"status": "ok"}, status=200)

        interactive = msg.get("interactive") or {}
        if "button_reply" in interactive:
            selected = (interactive.get("button_reply") or {}).get("id")
            if selected == "product":
                r = send_skin_list(user)
                _report(r, "skin_list")
                if not r.get("ok"):
                    _report(
                        send_text(user, "Skin issues: acne, dark, pigment, dry. Reply with one keyword."),
                        "skin_list_fallback",
                    )
            elif selected == "consult":
                _report(send_text(user, "Our expert will contact you soon."), "consult")
            elif selected == "info":
                _report(send_text(user, "Visit our website: https://qr.niayouthfulglow.com"), "info")
            return JsonResponse({"status": "ok"}, status=200)

        if "list_reply" in interactive:
            selected = (interactive.get("list_reply") or {}).get("id")
            if selected == "acne":
                _report(send_text(user, "For acne-prone skin: use salicylic acid and keep skin hydrated."), "acne")
            elif selected == "dark":
                _report(
                    send_text(user, "For dark circles: use caffeine eye serum and maintain regular sleep."),
                    "dark",
                )
            elif selected == "pigment":
                _report(send_text(user, "For pigmentation: use vitamin C in daytime and sunscreen daily."), "pigment")
            elif selected == "dry":
                _report(send_text(user, "For dry skin: use ceramide moisturizer and gentle cleanser."), "dry")
    except Exception as e:
        print("whatsapp_webhook_error:", e)

    return JsonResponse({"status": "ok"}, status=200)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def whatsapp_manual_menu(request):
    to = (request.data.get("to") or "").strip() or configured_destination_number()
    if not to:
        return Response({"detail": "Missing recipient number. Configure destination link/number or pass 'to'."}, status=400)
    if not whatsapp_enabled():
        return Response({"detail": "WhatsApp is not configured."}, status=400)
    result = send_main_menu(to)
    if not result.get("ok"):
        print("whatsapp_manual_menu_failed:", result)
        return Response({"ok": False, "send_result": result}, status=502)
    return Response({"ok": True, "to": to, "send_result": result})
