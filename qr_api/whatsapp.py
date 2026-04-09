from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs, urlparse

import requests
from django.conf import settings


def _cfg(name: str, default: str = "") -> str:
    return str(getattr(settings, name, default) or "").strip()


def whatsapp_enabled() -> bool:
    return bool(_cfg("WHATSAPP_ACCESS_TOKEN") and _cfg("WHATSAPP_PHONE_NUMBER_ID"))


def extract_whatsapp_number(link: str) -> str:
    s = (link or "").strip()
    if not s:
        return ""
    if s.isdigit():
        return s
    try:
        u = urlparse(s)
        path = (u.path or "").strip("/")
        if path.isdigit():
            return path
        qs = parse_qs(u.query or "")
        for key in ("phone", "to", "number"):
            v = (qs.get(key) or [""])[0].strip()
            if v.isdigit():
                return v
    except ValueError:
        return ""
    return ""


def configured_destination_number() -> str:
    # Prefer a parsed number from destination link; fallback to plain configured business number.
    by_link = extract_whatsapp_number(_cfg("WHATSAPP_DESTINATION_LINK"))
    if by_link:
        return by_link
    digits = "".join(ch for ch in _cfg("WHATSAPP_BUSINESS_NUMBER") if ch.isdigit())
    return digits


def extract_prefilled_text(link: str) -> str:
    s = (link or "").strip()
    if not s:
        return ""
    try:
        u = urlparse(s)
        qs = parse_qs(u.query or "")
        return (qs.get("text") or [""])[0].strip()
    except ValueError:
        return ""


def send_request(data: dict[str, Any]) -> dict[str, Any]:
    phone_number_id = _cfg("WHATSAPP_PHONE_NUMBER_ID")
    access_token = _cfg("WHATSAPP_ACCESS_TOKEN")
    if not phone_number_id or not access_token:
        return {"ok": False, "error": "whatsapp_not_configured"}

    url = f"https://graph.facebook.com/v22.0/{phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    try:
        r = requests.post(url, json=data, headers=headers, timeout=10)
        try:
            body = r.json() if r.content else {}
        except ValueError:
            body = {"raw_text": r.text}
        if r.ok:
            return {"ok": True, "status_code": r.status_code, "data": body}
        return {"ok": False, "status_code": r.status_code, "data": body}
    except requests.RequestException as e:
        return {"ok": False, "error": str(e)}


def send_text(to: str, message: str) -> dict[str, Any]:
    data = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": message},
    }
    return send_request(data)


def send_main_menu(to: str) -> dict[str, Any]:
    data = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "interactive",
        "interactive": {
            "type": "button",
            "body": {"text": "Select a topic 👇"},
            "action": {
                "buttons": [
                    {"type": "reply", "reply": {"id": "product", "title": "Product for you"}},
                    {"type": "reply", "reply": {"id": "consult", "title": "Consultation"}},
                    {"type": "reply", "reply": {"id": "info", "title": "All you need"}},
                ]
            },
        },
    }
    return send_request(data)


def send_skin_list(to: str) -> dict[str, Any]:
    data = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "interactive",
        "interactive": {
            "type": "list",
            "body": {"text": "Select Skin Issue 👇"},
            "action": {
                "button": "Choose",
                "sections": [
                    {
                        "title": "Skin Issues",
                        "rows": [
                            {"id": "acne", "title": "Acne"},
                            {"id": "dark", "title": "Dark Circles"},
                            {"id": "pigment", "title": "Pigmentation"},
                            {"id": "dry", "title": "Dry Skin"},
                        ],
                    }
                ],
            },
        },
    }
    return send_request(data)
