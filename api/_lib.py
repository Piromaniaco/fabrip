# -*- coding: utf-8 -*-
"""
API de TikTok (Display API) para las funciones serverless de Vercel.

Vercel no tiene disco persistente ni un unico proceso, por eso:
  * la configuracion vive en variables de entorno (Settings -> Environment Variables)
  * los tokens se guardan en cookies HttpOnly del navegador
  * el cache de 5 minutos vive en memoria de la instancia (mejor esfuerzo)

Cada archivo .py dentro de /api define `class handler(BaseHTTPRequestHandler)`,
que es el formato que soporta Vercel para funciones Python en /api.
"""

import json
import os
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

# ------------------------------------------------------------------ constantes

AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/"
TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"
VIDEO_LIST_URL = "https://open.tiktokapis.com/v2/video/list/"
SCOPE = "user.info.basic,video.list"
VIDEO_FIELDS = ",".join([
    "id", "title", "video_description", "duration",
    "cover_image_url", "create_time", "share_url", "embed_link",
    "view_count", "like_count",
])

CACHE_TTL = 300        # segundos de cache para "tiempo real" sin gastar cuota
REFRESH_MARGIN = 300   # renueva el access token si vence en menos de 5 min

CK_ACCESS = "fp_at"    # access token (cookie 1)
CK_REFRESH = "fp_rt"   # refresh token (cookie 2)
CK_STATE = "fp_state"  # state del flujo OAuth (CSRF)

MESSAGES = {
    "not_configured": "Falta configurar la API de TikTok (variables de entorno en Vercel).",
    "not_authorized": "Todavia no autorizaste la cuenta de TikTok.",
    "expired": "La autorizacion vencio: hay que volver a conectar la cuenta.",
    "api_error": "TikTok no respondio. Se reintenta en unos minutos.",
}

_cache = {"videos": None, "at": 0.0}


class BaseHandler(BaseHTTPRequestHandler):
    """Handler base: silencia los logs por linea (Vercel ya guarda stdout)."""

    server_version = "FabriPiro/1.0"

    def log_message(self, fmt, *args):
        pass


# ------------------------------------------------------------ respuesta / red

def send_json(handler, payload, cookies=(), cache="no-store"):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    if cache:
        handler.send_header("Cache-Control", cache)
    for cookie in cookies:
        handler.send_header("Set-Cookie", cookie)
    handler.end_headers()
    handler.wfile.write(body)


def redirect(handler, location, cookies=()):
    handler.send_response(302)
    handler.send_header("Location", location)
    handler.send_header("Content-Length", "0")
    for cookie in cookies:
        handler.send_header("Set-Cookie", cookie)
    handler.end_headers()


def base_url(handler):
    host = (handler.headers.get("X-Forwarded-Host")
            or handler.headers.get("Host") or "").strip()
    proto = (handler.headers.get("X-Forwarded-Proto") or "https").strip()
    if not host:
        return ""
    return "%s://%s" % (proto, host)


def query_of(handler):
    return urllib.parse.parse_qs(urllib.parse.urlparse(handler.path).query)


def read_cookies(handler):
    raw = handler.headers.get("Cookie") or ""
    out = {}
    for part in raw.split(";"):
        if "=" in part:
            name, value = part.split("=", 1)
            out[name.strip()] = urllib.parse.unquote(value.strip())
    return out


# -------------------------------------------------------------- configuracion

def load_config(handler=None):
    """Variables de entorno de Vercel (o tiktok_config.json si existe)."""
    key = (os.environ.get("TIKTOK_CLIENT_KEY") or "").strip()
    secret = (os.environ.get("TIKTOK_CLIENT_SECRET") or "").strip()
    redirect = (os.environ.get("TIKTOK_REDIRECT_URI") or "").strip()

    # El redirect se puede derivar del propio request: tiene que coincidir
    # exactamente con el registrado en developers.tiktok.com
    if not redirect and handler is not None:
        base = base_url(handler)
        if base:
            redirect = base + "/api/auth/callback"

    placeholders = ("PEGA_", "PEGA ", "TU_", "REEMPLAZA")
    configured = bool(key and secret)
    for token in placeholders:
        if key.upper().startswith(token) or secret.upper().startswith(token):
            configured = False
    if configured and not redirect:
        configured = False

    return {"client_key": key, "client_secret": secret,
            "redirect_uri": redirect}, configured


# --------------------------------------------------------------------- tokens

def build_tokens(data, keep_refresh=None):
    now = time.time()
    return {
        "access_token": data.get("access_token", ""),
        "expires_at": now + int(data.get("expires_in", 86400) or 86400),
        "refresh_token": data.get("refresh_token") or keep_refresh or "",
        "refresh_expires_at": now + int(data.get("refresh_expires_in", 31536000) or 31536000),
        "open_id": data.get("open_id", ""),
        "scope": data.get("scope", SCOPE),
    }


def _cookie(name, payload, max_age):
    value = payload if isinstance(payload, str) else json.dumps(payload, separators=(",", ":"))
    return "%s=%s; Path=/; Max-Age=%d; HttpOnly; Secure; SameSite=Lax" % (
        name, urllib.parse.quote(value, safe=""), int(max_age))


def cookies_for_tokens(tokens):
    """Access y refresh en cookies SEPARADAS (cada cookie tiene limite de 4 KB)."""
    now = time.time()
    max_age = max(3600, int(tokens.get("refresh_expires_at", 0) - now))
    access = {
        "access_token": tokens.get("access_token", ""),
        "expires_at": tokens.get("expires_at", 0),
        "open_id": tokens.get("open_id", ""),
        "scope": tokens.get("scope", ""),
    }
    refresh = {
        "refresh_token": tokens.get("refresh_token", ""),
        "refresh_expires_at": tokens.get("refresh_expires_at", 0),
    }
    return [
        _cookie(CK_ACCESS, access, max_age),
        _cookie(CK_REFRESH, refresh, max_age),
    ]


def load_tokens(handler):
    ck = read_cookies(handler)

    def _decode(name):
        try:
            return json.loads(ck.get(name) or "{}") or {}
        except Exception:
            return {}

    access = _decode(CK_ACCESS)
    refresh = _decode(CK_REFRESH)
    return {
        "access_token": access.get("access_token", ""),
        "expires_at": access.get("expires_at", 0),
        "open_id": access.get("open_id", ""),
        "scope": access.get("scope", ""),
        "refresh_token": refresh.get("refresh_token", ""),
        "refresh_expires_at": refresh.get("refresh_expires_at", 0),
    }


def http_json(url, data=None, headers=None, timeout=20):
    """POST/GET JSON. Devuelve (dict, status)."""
    hdrs = {"User-Agent": "FabriPiroLanding/1.0", "Accept": "application/json"}
    if headers:
        hdrs.update(headers)

    body = None
    if isinstance(data, dict):
        body = json.dumps(data).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json; charset=UTF-8")
    elif data is not None:
        body = data

    req = urllib.request.Request(url, data=body, headers=hdrs,
                                 method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
        return json.loads(raw) if raw.strip() else {}, 200
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8", "replace")
            return json.loads(detail) if detail.strip() else {}, exc.code
        except Exception:
            return {}, exc.code
    except Exception:
        return {}, 0


def refresh_tokens(cfg, tokens):
    payload = urllib.parse.urlencode({
        "client_key": cfg["client_key"],
        "client_secret": cfg["client_secret"],
        "grant_type": "refresh_token",
        "refresh_token": tokens.get("refresh_token", ""),
    }).encode("utf-8")

    data, status = http_json(
        TOKEN_URL, data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    if status != 200 or not data.get("access_token"):
        return None, status
    return build_tokens(data, keep_refresh=tokens.get("refresh_token")), 200


def get_access_token(handler):
    """(token, motivo, cookies-a-actualizar)."""
    tokens = load_tokens(handler)
    if not tokens.get("access_token"):
        return None, "not_authorized", []

    now = time.time()
    if tokens.get("expires_at", 0) - REFRESH_MARGIN > now:
        return tokens["access_token"], None, []

    if not tokens.get("refresh_token") or tokens.get("refresh_expires_at", 0) <= now:
        return None, "expired", []

    cfg, configured = load_config(handler)
    if not configured:
        return None, "not_configured", []

    merged, status = refresh_tokens(cfg, tokens)
    if not merged:
        return None, "expired", []
    return merged["access_token"], None, cookies_for_tokens(merged)


# -------------------------------------------------------------------- videos

def normalize_video(raw):
    vid = str(raw.get("id") or "").strip()
    title = (raw.get("title") or raw.get("video_description") or "").strip()
    embed = raw.get("embed_link") or ("https://www.tiktok.com/embed/v2/" + vid)
    share = raw.get("share_url") or ("https://www.tiktok.com/@piromanniaco/video/" + vid)
    return {
        "id": vid,
        "title": title,
        "cover": raw.get("cover_image_url") or "",
        "embed": embed,
        "url": share,
        "duration": int(raw.get("duration") or 0),
        "views": raw.get("view_count"),
        "likes": raw.get("like_count"),
        "created": raw.get("create_time"),
    }


def fetch_videos(handler):
    """(videos, motivo, cookies)."""
    token, reason, cookies = get_access_token(handler)
    if reason:
        return None, reason, cookies

    url = VIDEO_LIST_URL + "?" + urllib.parse.urlencode({"fields": VIDEO_FIELDS})
    data, status = http_json(
        url, data=json.dumps({"max_count": 30}).encode("utf-8"),
        headers={"Authorization": "Bearer " + token,
                 "Content-Type": "application/json; charset=UTF-8"},
    )

    if status in (401, 403):
        return None, "expired", cookies
    if status != 200:
        return None, "api_error", cookies

    err = data.get("error") or {}
    code = err.get("code", 0)
    if code not in (0, None):
        text = str(err.get("message", "")).lower()
        if status in (401, 403) or "token" in text or "auth" in text:
            return None, "expired", cookies
        return None, "api_error", cookies

    items = (data.get("data") or {}).get("videos") or []
    videos = [v for v in (normalize_video(v) for v in items) if v["id"]]

    _cache["videos"] = videos
    _cache["at"] = time.time()
    return videos, None, cookies


def api_status(handler):
    cfg, configured = load_config(handler)
    tokens = load_tokens(handler)
    now = time.time()
    authorized = bool(tokens.get("access_token")) and tokens.get("refresh_expires_at", 0) > now
    cached = _cache["videos"]
    return {
        "configured": configured,
        "authorized": authorized,
        "count": len(cached or []),
        "cached": cached is not None,
        "expires_in": int(max(0, tokens.get("expires_at", 0) - now)),
        "redirect_uri": cfg["redirect_uri"] if configured else "",
    }


def api_videos(handler):
    """(payload, cookies)."""
    _, configured = load_config(handler)
    if not configured:
        return {"ok": False, "reason": "not_configured",
                "message": MESSAGES["not_configured"]}, []

    now = time.time()
    cached, at = _cache["videos"], _cache["at"]
    if cached is not None and now - at < CACHE_TTL:
        return {"ok": True, "videos": cached, "updated_at": at, "cached": True}, []

    videos, reason, cookies = fetch_videos(handler)
    if reason:
        if cached is not None:
            # mejor mostrar el ultimo listado bueno que dejar la seccion vacia
            return {"ok": True, "videos": cached, "updated_at": at,
                    "cached": True, "stale": True, "reason": reason}, cookies
        return {"ok": False, "reason": reason,
                "message": MESSAGES.get(reason, "Error desconocido")}, cookies

    return {"ok": True, "videos": videos, "updated_at": _cache["at"]}, cookies


def invalidate_cache():
    _cache["videos"] = None
    _cache["at"] = 0.0


# --------------------------------------------------------------------- OAuth

def oauth_login(handler):
    """(location, cookies)."""
    cfg, configured = load_config(handler)
    if not configured:
        return "/?auth=not_configured", []

    state = secrets.token_urlsafe(24)
    qs = urllib.parse.urlencode({
        "client_key": cfg["client_key"],
        "response_type": "code",
        "scope": SCOPE,
        "redirect_uri": cfg["redirect_uri"],
        "state": state,
    })
    cookie = _cookie(CK_STATE, state, 600)
    return AUTHORIZE_URL + "?" + qs, [cookie]


def oauth_callback(handler):
    """(location, cookies). Devuelve siempre una ruta relativa al sitio."""
    query = query_of(handler)
    state = query.get("state", [""])[0]
    code = query.get("code", [""])[0]
    cookie_state = read_cookies(handler).get(CK_STATE, "")

    clear_state = _cookie(CK_STATE, "", 0)
    if not code or not state or not cookie_state or not secrets.compare_digest(state, cookie_state):
        return "/?auth=state", [clear_state]

    cfg, configured = load_config(handler)
    if not configured:
        return "/?auth=not_configured", [clear_state]

    payload = urllib.parse.urlencode({
        "client_key": cfg["client_key"],
        "client_secret": cfg["client_secret"],
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": cfg["redirect_uri"],
    }).encode("utf-8")

    data, status = http_json(
        TOKEN_URL, data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    if status != 200 or not data.get("access_token"):
        return "/?auth=error", [clear_state]

    invalidate_cache()
    tokens = build_tokens(data)
    return "/?auth=ok", [clear_state] + cookies_for_tokens(tokens)


# ------------------------------------------------- Google Drive (portafolios)
#
# La carpeta es publica: se lee sin API key leyendo el JSON que Drive embebe
# en la pagina (_DRIVE_ivd). Los bytes de video NO se pueden enlazar desde
# otro dominio (Drive responde 403 a todo request con Sec-Fetch-Site:
# cross-site), por eso el frontend los pide a /drive/video/<id>: en Vercel es
# un rewrite en el borde y en local un proxy con Range (proxy_media).

DRIVE_FOLDER = "1Lz70RyHCrOL43buC4mfrubPutl7TGpzP"
DRIVE_LIST_URL = "https://drive.google.com/drive/folders/" + DRIVE_FOLDER
DRIVE_VIDEO_URL = "https://drive.usercontent.google.com/download?id=%s&export=view&confirm=t"
DRIVE_THUMB_URL = "https://lh3.googleusercontent.com/d/%s=s640"

PL_TTL = 60          # segundos de cache del listado (la carpeta "siempre" al dia)
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

_pl_cache = {"videos": None, "at": 0.0}


def http_text(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", "replace"), 200
    except urllib.error.HTTPError as exc:
        return "", exc.code
    except Exception:
        return "", 0


def _drive_ivd(html):
    """Decodifica window['_DRIVE_ivd'], el JSON con el listado de la carpeta."""
    m = re.search(r"window\['_DRIVE_ivd'\]\s*=\s*'", html)
    if not m:
        return None
    i, buf = m.end(), []
    while i < len(html):
        c = html[i]
        if c == "\\" and i + 1 < len(html):
            buf.append(html[i:i + 2])
            i += 2
            continue
        if c == "'":
            break
        buf.append(c)
        i += 1
    raw = re.sub(r"\\x([0-9a-fA-F]{2})", lambda g: chr(int(g.group(1), 16)), "".join(buf))
    raw = raw.replace("\\/", "/").replace("\\'", "'")
    try:
        return json.loads(raw)
    except Exception:
        return None


def _find_entries(node, depth=0):
    if depth > 4:
        return None
    if isinstance(node, str):
        try:
            return _find_entries(json.loads(node), depth + 1)
        except Exception:
            return None
    if isinstance(node, list) and node and isinstance(node[0], list) \
            and isinstance(node[0][0], str) and isinstance(node[0][1], list):
        return node
    if isinstance(node, list):
        for item in node:
            found = _find_entries(item, depth + 1)
            if found:
                return found
    return None


def _video_name(entry):
    """El nombre viene en el campo 2; a veces Drive deja un marcador (N_VIDEO)
    o la app de origen (DriveSdkV2) en su lugar, y ahi se toma el campo 41."""
    for idx in (2, 41):
        value = entry[idx] if len(entry) > idx else None
        if not isinstance(value, str):
            continue
        value = value.strip()
        if not value or value.endswith("_VIDEO") or value == "DriveSdkV2":
            continue
        return value
    return "Video"


def parse_folder(html):
    """-> [{id, name, size, mime, video, thumb}] en el orden que manda Drive."""
    entries = _find_entries(_drive_ivd(html))
    videos = []
    for entry in entries or []:
        if not isinstance(entry, list) or not entry or not isinstance(entry[0], str):
            continue
        fid = entry[0]
        if fid == DRIVE_FOLDER:
            continue
        mime = entry[3] if len(entry) > 3 and isinstance(entry[3], str) else ""
        if not mime.startswith("video/"):
            continue
        size = entry[13] if len(entry) > 13 and isinstance(entry[13], int) else 0
        videos.append({
            "id": fid,
            "name": _video_name(entry),
            "size": size,
            "mime": mime,
            "video": "/drive/video/" + fid,
            "thumb": "/drive/thumb/" + fid,
        })
    return videos


def fetch_portafolios():
    """(videos, updated_at) cacheando PL_TTL segundos para no agotar a Drive."""
    now = time.time()
    cached, at = _pl_cache["videos"], _pl_cache["at"]
    if cached is not None and now - at < PL_TTL:
        return cached, at

    html, status = http_text(DRIVE_LIST_URL)
    if status != 200:
        if cached is not None:
            return cached, at
        return [], at

    videos = parse_folder(html)
    _pl_cache["videos"] = videos
    _pl_cache["at"] = now
    return videos, now


def api_portafolios():
    videos, at = fetch_portafolios()
    payload = {"ok": True, "folder": DRIVE_FOLDER, "updated_at": at,
               "count": len(videos), "videos": videos}
    if not videos:
        payload["ok"] = False
        payload["reason"] = "empty"
        payload["message"] = "La carpeta de Google Drive todavía no tiene videos."
    return payload


def proxy_media(handler, url):
    """Transmite un archivo remoto conservando Range (lo que usa el seek del video)."""
    headers = {"User-Agent": BROWSER_UA, "Accept": "*/*"}
    rng = handler.headers.get("Range")
    if rng:
        headers["Range"] = rng

    try:
        resp = urllib.request.urlopen(
            urllib.request.Request(url, headers=headers), timeout=45)
    except urllib.error.HTTPError as exc:
        handler.send_response(exc.code)
        handler.send_header("Content-Length", "0")
        handler.end_headers()
        return
    except Exception:
        handler.send_response(502)
        handler.send_header("Content-Length", "0")
        handler.end_headers()
        return

    try:
        handler.send_response(resp.status)
        for key in ("Content-Type", "Content-Length", "Content-Range",
                    "Accept-Ranges", "Content-Disposition"):
            value = resp.headers.get(key)
            if value:
                handler.send_header(key, value)
        handler.send_header("Cache-Control", "public, max-age=3600")
        handler.end_headers()
        while True:
            chunk = resp.read(65536)
            if not chunk:
                break
            handler.wfile.write(chunk)
    except (BrokenPipeError, ConnectionResetError, OSError):
        pass  # el navegador dejo de leer, normal con video
    finally:
        try:
            resp.close()
        except Exception:
            pass


# ------------------------------------------- handler de cortesia para _lib.py
# Vercel convierte cada .py de /api en una funcion, asi que este modulo
# tambien expone un endpoint inofensivo en /api/_lib.

class handler(BaseHandler):
    def do_GET(self):
        send_json(self, {"ok": True, "service": "fabri-piro-api"})
