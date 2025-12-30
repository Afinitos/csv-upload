# uploads/vanna_fastapi_server.py
import os
import threading

from vanna.servers.fastapi import VannaFastAPIServer
from .vanna_service import get_vanna_service

_started = False
_lock = threading.Lock()


def start_vanna_fastapi_server():
    """
    Start VannaFastAPIServer once, in a background thread.
    Runs on 127.0.0.1:9001 by default.
    """
    global _started
    with _lock:
        if _started:
            return
        _started = True

    host = os.getenv("VANNA_INTERNAL_HOST", "127.0.0.1")
    port = int(os.getenv("VANNA_INTERNAL_PORT", "9001"))

    agent = get_vanna_service().agent
    server = VannaFastAPIServer(agent)

    t = threading.Thread(
        target=lambda: server.run(host=host, port=port),
        daemon=True,
        name="vanna-fastapi-server",
    )
    t.start()
