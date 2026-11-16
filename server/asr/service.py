"""OpenPodium bounded, access-code gated, audio-only ASR. No audio/text logging."""
import hashlib
import hmac
import io
import json
import os
import queue
import secrets
import subprocess
import struct
import sys
import tempfile
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ORIGIN = os.environ.get('ASR_ORIGIN', 'https://openpodium.chensibo.cn')
ACCESS_HASH = Path('/run/secrets/access.sha256').read_text().strip()
if len(ACCESS_HASH) != 64:
    raise RuntimeError('Missing access-code hash')
MAX_BYTES = 1920044
SESSION_TTL = 300
JOB_TTL = 300
MAX_SESSIONS = 32
jobs = {}
sessions = {}
lock = threading.RLock()
pending = queue.Queue(maxsize=2)
login_times = []
upload_times = []
TEMP = Path('/tmp/asr')
TEMP.mkdir(mode=0o700, exist_ok=True)


class Rejection(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, code


def remove_audio(job):
    path = job.pop('path', None)
    if path:
        Path(path).unlink(missing_ok=True)


def cancel(job):
    job['state'] = 'cancelled'
    proc = job.get('process')
    if proc and proc.poll() is None:
        # The inference subprocess owns no durable state; kill also handles a stopped worker.
        proc.kill()
    remove_audio(job)


def expire():
    now = time.monotonic()
    for token, session in list(sessions.items()):
        if now >= session['expires']:
            del sessions[token]
    for key, job in list(jobs.items()):
        if job['token'] not in sessions or now >= job['expires']:
            cancel(job)
            del jobs[key]


def rate(times, limit, seconds=60):
    now = time.monotonic()
    times[:] = [t for t in times if now - t < seconds]
    if len(times) >= limit:
        raise Rejection(429, 'rate_limit')
    times.append(now)


def validate_wav(body):
    try:
        # Accept canonical PCM only: rejects hidden metadata, video payloads and trailing bytes.
        if (len(body) < 44 or body[:4] != b'RIFF' or body[8:16] != b'WAVEfmt '
                or body[36:40] != b'data' or struct.unpack_from('<I', body, 16)[0] != 16
                or struct.unpack_from('<I', body, 4)[0] != len(body) - 8
                or struct.unpack_from('<I', body, 40)[0] != len(body) - 44
                or struct.unpack_from('<I', body, 28)[0] != 32000
                or struct.unpack_from('<H', body, 32)[0] != 2):
            raise ValueError()
        with wave.open(io.BytesIO(body), 'rb') as wav:
            frames = wav.getnframes()
            if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype()) != (1, 2, 16000, 'NONE'):
                raise ValueError()
            if not 1600 <= frames <= 960000 or len(body) != 44 + frames * 2 or len(wav.readframes(frames)) != frames * 2:
                raise ValueError()
            return frames / 16000
    except (wave.Error, EOFError, ValueError):
        raise Rejection(415, 'wav_16khz_mono_pcm16_required')


def worker():
    while True:
        key = pending.get()
        try:
            with lock:
                expire()
                job = jobs.get(key)
                if not job or job['state'] != 'queued':
                    continue
                job['state'] = 'running'
                job['queueSec'] = round(time.monotonic() - job['created'], 3)
                try:
                    proc = subprocess.Popen([sys.executable, '-I', '/app/worker.py', job['path']],
                                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                            env={**os.environ, 'OMP_NUM_THREADS': '1', 'OPENBLAS_NUM_THREADS': '1'})
                except OSError:
                    job['state'], job['error'] = 'failed', 'inference_failed'
                    remove_audio(job)
                    continue
                job['process'] = proc
            try:
                out, _ = proc.communicate(timeout=90)
                if proc.returncode or len(out) > 65536:
                    raise ValueError('inference_failed')
                result = json.loads(out)
                with lock:
                    if job['state'] == 'running':
                        job['result'] = result
                        job['state'] = 'succeeded'
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.communicate()
                with lock:
                    if job['state'] != 'cancelled':
                        job['state'], job['error'] = 'failed', 'inference_timeout'
            except Exception:
                with lock:
                    if job['state'] != 'cancelled':
                        job['state'], job['error'] = 'failed', 'inference_failed'
            finally:
                with lock:
                    job.pop('process', None)
                    remove_audio(job)
        finally:
            pending.task_done()


def janitor():
    while True:
        time.sleep(2)
        with lock:
            expire()


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'

    def log_message(self, *_):
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def respond(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self, maximum):
        if self.headers.get('Transfer-Encoding'):
            raise Rejection(400, 'content_length_required')
        try:
            length = int(self.headers.get('Content-Length', '-1'))
        except ValueError:
            raise Rejection(400, 'content_length_required')
        if length < 1:
            raise Rejection(400, 'empty_body')
        if length > maximum:
            raise Rejection(413, 'audio_too_large')
        data = self.rfile.read(length)
        if len(data) != length:
            raise Rejection(400, 'incomplete_body')
        return data

    def handle_request(self):
        # Browsers normally omit Origin on same-origin GET. A read still requires
        # its unguessable bearer token; reject any explicitly foreign Origin.
        origin = self.headers.get('Origin')
        if origin != ORIGIN and not (self.command == 'GET' and origin is None):
            raise Rejection(403, 'origin_denied')
        path = self.path
        if self.command == 'GET' and path == '/health':
            ready = (inference_thread.is_alive() and
                     all(os.access('/models/' + name, os.R_OK)
                         for name in ('model.int8.onnx', 'tokens.txt')))
            return self.respond(200 if ready else 503,
                                {'status': 'ok' if ready else 'unavailable', 'engine': 'server',
                                 'maxDurationSec': 60, 'maxBytes': MAX_BYTES})
        if self.command == 'POST' and path == '/session':
            with lock:
                expire()
                rate(login_times, 8)
            try:
                data = json.loads(self.body(512))
                access = str(data.get('accessCode', ''))
            except (ValueError, AttributeError):
                raise Rejection(400, 'invalid_json')
            if not hmac.compare_digest(hashlib.sha256(access.encode()).hexdigest(), ACCESS_HASH):
                raise Rejection(401, 'access_denied')
            with lock:
                if len(sessions) >= MAX_SESSIONS:
                    raise Rejection(503, 'session_capacity')
                token = secrets.token_urlsafe(32)
                sessions[token] = {'expires': time.monotonic() + SESSION_TTL,
                                   'ip': self.client_address[0], 'uploads': [], 'polls': []}
            return self.respond(201, {'token': token, 'expiresIn': SESSION_TTL,
                                      'maxDurationSec': 60, 'maxBytes': MAX_BYTES})
        token = self.headers.get('Authorization', '').removeprefix('Bearer ')
        with lock:
            expire()
            session = sessions.get(token)
            if not session or session['ip'] != self.client_address[0]:
                raise Rejection(401, 'session_expired')
            rate(session['polls'], 180)
            if self.command == 'POST' and path == '/jobs':
                if self.headers.get('X-ASR-Consent') != 'audio-only-v1':
                    raise Rejection(403, 'consent_required')
                rate(session['uploads'], 3)
                rate(upload_times, 12)
                if sum(j['state'] in ('queued', 'uploading', 'running') for j in jobs.values()) >= 3:
                    raise Rejection(429, 'queue_full')
                if sum(j['token'] == token for j in jobs.values()) >= 3 or len(jobs) >= 96:
                    raise Rejection(429, 'job_capacity')
                key = secrets.token_urlsafe(18)
                job = {'state': 'uploading', 'token': token, 'created': time.monotonic(),
                       'expires': time.monotonic() + JOB_TTL}
                jobs[key] = job
            else:
                key = path.removeprefix('/jobs/')
                job = jobs.get(key) if path.startswith('/jobs/') else None
                if not job or job['token'] != token:
                    raise Rejection(404, 'job_not_found')
                if self.command == 'DELETE':
                    cancel(job)
                    del jobs[key]
                    return self.respond(200, {'state': 'deleted'})
                if self.command != 'GET':
                    raise Rejection(405, 'method_not_allowed')
                return self.respond(200, {k: job[k] for k in ('state', 'result', 'error', 'queueSec') if k in job})
        try:
            if self.headers.get('Content-Type', '').split(';')[0] != 'audio/wav':
                raise Rejection(415, 'wav_16khz_mono_pcm16_required')
            body = self.body(MAX_BYTES)
            validate_wav(body)
            with lock:
                if job['state'] != 'uploading' or token not in sessions:
                    raise Rejection(401, 'session_expired')
                fd, name = tempfile.mkstemp(prefix='audio-', suffix='.wav', dir=TEMP)
                job['path'] = name
                with os.fdopen(fd, 'wb') as f:
                    f.write(body)
                job['state'] = 'queued'
                try:
                    pending.put_nowait(key)
                except queue.Full:
                    raise Rejection(429, 'queue_full')
            self.respond(202, {'id': key, 'state': 'queued'})
        except BaseException:
            with lock:
                cancel(job)
                jobs.pop(key, None)
            raise

    def route(self):
        try:
            self.handle_request()
        except Rejection as error:
            self.respond(error.status, {'error': error.code})
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except Exception:
            self.respond(500, {'error': 'internal_error'})

    do_GET = do_POST = do_DELETE = route


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8
    slots = threading.BoundedSemaphore(12)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


if __name__ == '__main__':
    inference_thread = threading.Thread(target=worker, daemon=True)
    inference_thread.start()
    threading.Thread(target=janitor, daemon=True).start()
    Server(('0.0.0.0', 8766), Handler).serve_forever()
