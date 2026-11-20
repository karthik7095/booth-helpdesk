"""Transliteration service for the desktop app's secondary-language columns.

Turns the English names of an English roll into Telugu or Hindi with the
AI4Bharat IndicXlit model, behind a tiny HTTP server bound to localhost. The
Fastify API is the only client: it checks the desktop licence and forwards the
words here.

  POST /transliterate  {"lang": "te"|"hi", "words": ["venkata", ...]}  ->  {"words": ["వెంకట", ...], "ms": 1234}
  GET  /health         ->  {"status": "ok", "model": "indicxlit", "langs": ["te", "hi"], "busy": false}

Words are processed one request at a time (the model is not thread-safe) and
cached in memory, so names repeated across rolls are answered instantly.
"""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import xlit

HOST = os.environ.get("XLIT_HOST", "127.0.0.1")
PORT = int(os.environ.get("XLIT_PORT", "4600"))
MAX_WORDS = int(os.environ.get("XLIT_MAX_WORDS", "400"))
MAX_BYTES = 256 * 1024

lock = threading.Lock()
busy = False
print(f"indicxlit ready ({', '.join(xlit.LANGS)}; rescore {'on' if xlit.RESCORE else 'off'})", flush=True)


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"status": "ok", "model": "indicxlit", "langs": list(xlit.LANGS), "busy": busy})
        self._send(404, {"message": "not found"})

    def do_POST(self):
        global busy
        if self.path != "/transliterate":
            return self._send(404, {"message": "not found"})
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > MAX_BYTES:
            return self._send(413, {"message": "request too large"})
        try:
            payload = json.loads(self.rfile.read(length))
            lang = payload.get("lang")
            words = payload.get("words") or []
            if lang not in xlit.LANGS:
                return self._send(400, {"message": f"lang must be one of {', '.join(xlit.LANGS)}"})
            if not isinstance(words, list) or not words or len(words) > MAX_WORDS:
                return self._send(400, {"message": f"send 1 to {MAX_WORDS} words"})
            if not all(isinstance(w, str) and xlit.WORD.fullmatch(w) and len(w) <= 40 for w in words):
                return self._send(400, {"message": "words must be Latin letters only"})
        except Exception as e:  # malformed JSON
            return self._send(400, {"message": f"bad request: {e}"})
        with lock:
            busy = True
            t = time.time()
            try:
                out = xlit.translit_words(words, lang)
            except Exception as e:
                return self._send(500, {"message": f"transliteration failed: {e}"})
            finally:
                busy = False
        self._send(200, {"words": out, "ms": int((time.time() - t) * 1000)})

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}", flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
