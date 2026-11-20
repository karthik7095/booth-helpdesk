"""Self-hosted OCR service for the roll converter's "cloud" mode.

Runs Surya (detection + recognition, CPU) behind a tiny HTTP server bound to
localhost. The Fastify API is the only client: it checks the desktop licence
and forwards voter-box images here.

  POST /recognize  {"images": ["<base64 png>", ...]}  ->  {"texts": ["...", ...], "ms": 1234}
  GET  /health     ->  {"status": "ok", "model": "surya", "busy": false}

One request is processed at a time (the models are not thread-safe and the
server is small); others wait on the lock. Each box is returned as its text
lines top to bottom, joined with newlines, ready for the converter's parsers.
"""
import base64
import io
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("TORCH_DEVICE", "cpu")
import torch  # noqa: E402
from PIL import Image  # noqa: E402
from surya.detection import DetectionPredictor  # noqa: E402
from surya.recognition import RecognitionPredictor  # noqa: E402

HOST = os.environ.get("OCR_HOST", "127.0.0.1")
PORT = int(os.environ.get("OCR_PORT", "4500"))
MAX_IMAGES = int(os.environ.get("OCR_MAX_IMAGES", "40"))
MAX_BYTES = int(os.environ.get("OCR_MAX_BYTES", str(20 * 1024 * 1024)))
# Small batches keep peak memory low; the systemd unit also caps memory.
REC_BATCH = int(os.environ.get("OCR_REC_BATCH", "8"))
DET_BATCH = int(os.environ.get("OCR_DET_BATCH", "2"))
torch.set_num_threads(int(os.environ.get("OCR_THREADS", "3")))

# The recognition model is 1.6 GB on disk; on CPU Surya would expand it to
# float32 (~3.2 GB resident plus loading overhead), more than this shared
# server can spare. bfloat16 halves that at some cost in speed.
DTYPE = getattr(torch, os.environ.get("OCR_DTYPE", "bfloat16"))

started = time.time()
det = DetectionPredictor()
rec = RecognitionPredictor(dtype=DTYPE)
lock = threading.Lock()
busy = False
print(f"surya loaded in {time.time() - started:.1f}s ({DTYPE})", flush=True)


def recognize(images):
    preds = rec(images, det_predictor=det, recognition_batch_size=REC_BATCH, detection_batch_size=DET_BATCH)
    texts = []
    for p in preds:
        lines = sorted(p.text_lines, key=lambda l: (round(l.bbox[1] / 8), l.bbox[0]))
        texts.append("\n".join(l.text for l in lines))
    return texts


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
            return self._send(200, {"status": "ok", "model": "surya", "busy": busy})
        self._send(404, {"message": "not found"})

    def do_POST(self):
        global busy
        if self.path != "/recognize":
            return self._send(404, {"message": "not found"})
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > MAX_BYTES:
            return self._send(413, {"message": "request too large"})
        try:
            payload = json.loads(self.rfile.read(length))
            raw = payload.get("images") or []
            if not isinstance(raw, list) or not raw or len(raw) > MAX_IMAGES:
                return self._send(400, {"message": f"send 1 to {MAX_IMAGES} images"})
            images = [Image.open(io.BytesIO(base64.b64decode(b))).convert("RGB") for b in raw]
        except Exception as e:  # malformed JSON or image
            return self._send(400, {"message": f"bad request: {e}"})
        with lock:
            busy = True
            t = time.time()
            try:
                texts = recognize(images)
            except Exception as e:
                return self._send(500, {"message": f"recognition failed: {e}"})
            finally:
                busy = False
        self._send(200, {"texts": texts, "ms": int((time.time() - t) * 1000)})

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}", flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
