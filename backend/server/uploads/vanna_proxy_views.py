# uploads/vanna_proxy_views.py
import os
import requests
from django.http import JsonResponse, StreamingHttpResponse, HttpResponse
from django.views.decorators.csrf import csrf_exempt

VANNA_BASE = os.getenv("VANNA_INTERNAL_BASE", "http://127.0.0.1:9001")


def _forward_headers(request):
    """
    Forward minimal headers that help auth/context.
    Add more as needed.
    """
    out = {}
    if request.headers.get("Authorization"):
        out["Authorization"] = request.headers["Authorization"]
    if request.headers.get("X-User-Email"):
        out["X-User-Email"] = request.headers["X-User-Email"]
    if request.headers.get("X-User-Group"):
        out["X-User-Group"] = request.headers["X-User-Group"]
    return out


@csrf_exempt
def chat_sse(request):
    """
    Proxy for Vanna SSE:
    GET/POST -> stream text/event-stream
    """
    url = f"{VANNA_BASE}/api/vanna/v2/chat_sse"
    headers = _forward_headers(request)

    # Forward body (for POST). Vanna web component usually sends POST with JSON.
    data = request.body if request.method != "GET" else None

    upstream = requests.request(
        method=request.method,
        url=url,
        headers=headers,
        data=data,
        stream=True,
        timeout=60,
    )

    def gen():
        try:
            for chunk in upstream.iter_content(chunk_size=1024):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    resp = StreamingHttpResponse(gen(), content_type="text/event-stream")
    resp["Cache-Control"] = "no-cache"
    resp["X-Accel-Buffering"] = "no"
    return resp


@csrf_exempt
def chat_poll(request):
    """
    Proxy for poll endpoint (JSON in/out).
    """
    url = f"{VANNA_BASE}/api/vanna/v2/chat_poll"
    headers = {"Content-Type": request.headers.get("Content-Type", "application/json")}
    headers.update(_forward_headers(request))

    upstream = requests.request(
        method=request.method,
        url=url,
        headers=headers,
        data=request.body,
        timeout=60,
    )

    # Mirror status + body
    return HttpResponse(
        upstream.content,
        status=upstream.status_code,
        content_type=upstream.headers.get("Content-Type", "application/json"),
    )


@csrf_exempt
def chat_websocket(request):
    """
    WebSocket proxy is NOT supported in Django WSGI runserver.
    Return 426 so frontend knows it can't upgrade.
    """
    return HttpResponse("WebSocket not supported on this server.", status=426)
