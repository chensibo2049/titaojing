"""Bounded quan2 acceptance, synthetic WAV only; never prints credentials.
Usage: python3 -I /opt/openpodium-asr-20261117/app/benchmark.py /path/synthetic.wav [--lifecycle] [--restart-check]
The lifecycle mode takes about 310 seconds (real 90-second timeout and 300-second TTL).
"""
import hashlib
import http.client
import io
import json
import pathlib
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error
import wave

BASE = 'http://127.0.0.1:8766'
ORIGIN = 'https://openpodium.chensibo.cn'
ROOT = pathlib.Path('/opt/openpodium-asr-20261117')
CODE = (ROOT / 'secrets/access-code').read_text().strip()
CONTAINER = 'openpodium-asr-20261117'
owned = []


def request(path, method='GET', data=None, token=None, consent=True, origin=ORIGIN, mime='audio/wav'):
    headers = {'Origin': origin, 'Content-Type': mime}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if consent:
        headers['X-ASR-Consent'] = 'audio-only-v1'
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as r:
        return r.code, json.load(r)


def session():
    status, data = request('/session', 'POST', json.dumps({'accessCode': CODE}).encode(), mime='application/json')
    assert status == 201, (status, data)
    return data['token']


def submit(token, audio):
    status, data = request('/jobs', 'POST', audio, token=token)
    assert status == 202, (status, data)
    owned.append((token, data['id']))
    return data['id']


def delete(token, key):
    assert request('/jobs/' + key, 'DELETE', token=token)[0] == 200


def docker_python(code):
    return subprocess.check_output(['docker', 'exec', CONTAINER, 'python', '-I', '-c', code], text=True, timeout=5).strip()


def temp_count():
    return int(docker_python('import os;print(len(os.listdir("/tmp/asr")))'))


def worker_pid():
    code = ('import pathlib; print(" ".join(p.name for p in pathlib.Path("/proc").iterdir() '
            'if p.name.isdigit() and b"/app/worker.py\\x00" in (p/"cmdline").read_bytes()))')
    pids = docker_python(code).split()
    assert len(pids) == 1, 'expected exactly one inference worker'
    return int(pids[0])


def stop_worker():
    pid = worker_pid()
    docker_python(f'import os,signal;os.kill({pid},signal.SIGSTOP)')
    return pid


def await_state(token, key, states, maximum=100):
    deadline = time.monotonic() + maximum
    while time.monotonic() < deadline:
        status, data = request('/jobs/' + key, token=token)
        assert status == 200, data
        if data['state'] in states:
            return data
        time.sleep(1)
    raise AssertionError('job state deadline exceeded')


def await_clean(maximum=5):
    deadline = time.monotonic() + maximum
    while time.monotonic() < deadline:
        if temp_count() == 0:
            return
        time.sleep(.2)
    raise AssertionError('temporary audio leaked')


def product_health():
    with urllib.request.urlopen(ORIGIN + '/version.json', timeout=10) as r:
        return {'status': r.status, 'sha256': hashlib.sha256(r.read()).hexdigest()}


def ready():
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            if request('/health')[1].get('status') == 'ok':
                return
        except (OSError, http.client.HTTPException):
            pass
        time.sleep(.2)
    raise AssertionError('service not ready')


def main():
    ready()
    fixture = pathlib.Path(sys.argv[1]).read_bytes()
    with wave.open(io.BytesIO(fixture), 'rb') as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, 16000)
        duration = w.getnframes() / w.getframerate()
        frames = w.readframes(w.getnframes())
    out = io.BytesIO()
    with wave.open(out, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes((frames * (int(60 / duration) + 1))[:60 * 32000])
    long_audio = out.getvalue()
    before = product_health()
    nginx = pathlib.Path('/etc/nginx/sites-available/openpodium.chensibo.cn.conf')
    nginx_before = hashlib.sha256(nginx.read_bytes()).hexdigest()
    cid = subprocess.check_output(['docker', 'inspect', '--format', '{{.Id}}', CONTAINER], text=True).strip()
    cgroup = pathlib.Path('/sys/fs/cgroup/system.slice/docker-' + cid + '.scope')
    def cpu():
        return int((cgroup / 'cpu.stat').read_text().split('usage_usec ')[1].splitlines()[0])
    cpu_before, wall = cpu(), time.monotonic()
    samples, stopping = [], threading.Event()
    def sample():
        while not stopping.is_set():
            try:
                samples.append(int((cgroup / 'memory.current').read_text()))
            except FileNotFoundError:
                pass  # cgroup temporarily absent during optional restart acceptance
            stopping.wait(.05)
    sampler = threading.Thread(target=sample, daemon=True)
    sampler.start()
    report = {'fixture': 'macOS synthetic Chinese TTS; no human recording', 'durationSec': duration}
    try:
        assert request('/session', 'POST', b'{"accessCode":"invalid"}', mime='application/json')[0] == 401
        token = session()
        assert request('/jobs', 'POST', b'x', token='invalid')[0] == 401
        assert request('/jobs', 'POST', b'x', token=token, origin='https://invalid.example')[0] == 403
        assert request('/jobs', 'POST', b'x', token=token, consent=False)[0] == 403
        checks = session()
        assert request('/jobs', 'POST', b'x', token=checks, mime='video/webm')[0] == 415
        assert request('/jobs', 'POST', b'not-wave', token=checks)[0] == 415
        assert request('/jobs', 'POST', fixture + b'x', token=checks)[0] == 415
        assert temp_count() == 0
        start, stage_cpu = time.monotonic(), cpu()
        key = submit(token, fixture)
        other = session()
        assert request('/jobs/' + key, token=other)[0] == 404
        assert product_health() == before
        result = await_state(token, key, ('succeeded', 'failed'))
        assert result['state'] == 'succeeded', result
        report['short'] = {'jobWallSec': round(time.monotonic() - start, 3),
                           'containerCpuSec': round((cpu() - stage_cpu) / 1000000, 3), **result}
        (ROOT / 'evidence/progress.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        await_clean()
        delete(token, key)
        start, stage_cpu = time.monotonic(), cpu()
        key = submit(token, long_audio)
        result = await_state(token, key, ('succeeded', 'failed'))
        assert result['state'] == 'succeeded', result
        report['long'] = {'jobWallSec': round(time.monotonic() - start, 3),
                          'containerCpuSec': round((cpu() - stage_cpu) / 1000000, 3), **result}
        (ROOT / 'evidence/progress.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        await_clean()
        delete(token, key)
        # Freeze the single inference child (no load) so capacity is deterministic.
        queue_tokens = [session(), session()]
        first = submit(queue_tokens[0], long_audio)
        await_state(queue_tokens[0], first, ('running',))
        pid = stop_worker()
        second = submit(queue_tokens[0], long_audio)
        third = submit(queue_tokens[1], long_audio)
        status, data = request('/jobs', 'POST', b'capacity-probe', token=queue_tokens[1])
        assert status == 429 and data['error'] == 'queue_full', (status, data)
        assert [request('/jobs/' + k, token=t)[1]['state'] for t, k in
                [(queue_tokens[0], first), (queue_tokens[0], second), (queue_tokens[1], third)]] == ['running', 'queued', 'queued']
        for t, k in [(queue_tokens[0], second), (queue_tokens[1], third), (queue_tokens[0], first)]:
            delete(t, k)
            assert request('/jobs/' + k, token=t)[0] == 404
        await_clean()
        report['queue'] = {'states': ['running', 'queued', 'queued'], 'fourthStatus': status,
                           'fourthError': data['error'], 'runningAndQueuedDeleted': True}
        if '--lifecycle' in sys.argv:
            # Upload quota rolls off naturally while the real timeout runs.
            ttl_token = session()
            ttl_started = time.monotonic()
            t = session()
            key = submit(t, long_audio)
            await_state(t, key, ('running',))
            stop_worker()
            started = time.monotonic()
            result = await_state(t, key, ('succeeded', 'failed'), maximum=100)
            assert result['state'] == 'failed' and result['error'] == 'inference_timeout', result
            await_clean()
            delete(t, key)
            report['timeout'] = {'elapsedSec': round(time.monotonic() - started, 3), **result, 'audioFiles': temp_count()}
            # Hard-kill an inference child: failure path must clean as well.
            key = submit(t, long_audio)
            await_state(t, key, ('running',))
            pid = worker_pid()
            docker_python(f'import os,signal;os.kill({pid},signal.SIGKILL)')
            result = await_state(t, key, ('failed',), maximum=5)
            assert result['error'] == 'inference_failed', result
            await_clean()
            delete(t, key)
            report['crashedWorker'] = result
            # Truncated/slow upload owns a reservation, but must clear it on socket timeout.
            conn = http.client.HTTPConnection('127.0.0.1', 8766, timeout=15)
            conn.putrequest('POST', '/jobs')
            for name, value in {'Origin': ORIGIN, 'Authorization': 'Bearer ' + t,
                                'X-ASR-Consent': 'audio-only-v1', 'Content-Type': 'audio/wav',
                                'Content-Length': str(len(fixture))}.items():
                conn.putheader(name, value)
            conn.endheaders(); conn.send(fixture[:44])
            started = time.monotonic()
            try:
                response = conn.getresponse()
                response.read()
            except (OSError, http.client.HTTPException):
                pass
            finally:
                conn.close()
            await_clean()
            report['slowUpload'] = {'socketClosedSec': round(time.monotonic() - started, 3), 'audioFiles': temp_count()}
            # A disconnected client that loses DELETE: process still cleans audio.
            recovery = session()
            key = submit(recovery, fixture)
            result = await_state(recovery, key, ('succeeded', 'failed'))
            assert result['state'] == 'succeeded', result
            await_clean()
            report['recoveredAfterTimeout'] = True
            # Leave this result un-deleted; actual five-minute expiry cleans in-memory objects.
            remaining = max(0, 303 - (time.monotonic() - ttl_started))
            time.sleep(remaining)
            status, data = request('/jobs/not-a-real-job', token=ttl_token)
            assert status == 401 and data['error'] == 'session_expired', (status, data)
            report['sessionTtl'] = {'elapsedSec': round(time.monotonic() - ttl_started, 3), 'status': status, 'error': data['error']}
        measured_cpu, measured_wall = cpu() - cpu_before, time.monotonic() - wall
        if '--restart-check' in sys.argv:
            restart_token = session()
            key = submit(restart_token, long_audio)
            await_state(restart_token, key, ('running',))
            stop_worker()
            assert temp_count() == 1
            subprocess.run(['docker', 'restart', '--time', '3', CONTAINER], check=True,
                           stdout=subprocess.DEVNULL, timeout=15)
            ready()
            await_clean()
            assert request('/jobs/' + key, token=restart_token)[0] == 401
            report['containerRestart'] = {'audioFilesBefore': 1, 'audioFilesAfter': 0,
                                          'oldSessionStatus': 401, 'health': request('/health')[1]}
        assert product_health() == before
        assert hashlib.sha256(nginx.read_bytes()).hexdigest() == nginx_before
        report.update({'health': before, 'nginxUnchanged': True, 'temporaryAudioFiles': temp_count(),
                       'containerMemorySampledPeakBytes': max(samples), 'memorySampleIntervalSec': .05,
                       'memoryPeakNote': 'sampled memory.current; kernel has no memory.peak',
                       'containerCpuSec': round(measured_cpu / 1000000, 3),
                       'benchmarkWallSec': round(measured_wall, 3),
                       'containerAverageCpuPercent': round(measured_cpu / 10000 / measured_wall, 2),
                       'checks': ['bad access-code/token', 'Origin', 'consent', 'video/malformed/trailing WAV rejection',
                                  'owner isolation', 'full queue 429', 'running/queued cancellation', 'success/cancel cleanup']})
        print(json.dumps(report, ensure_ascii=False, indent=2))
    finally:
        # Also clean after assertion failures; never leave suspended inference behind.
        for t, key in owned:
            try:
                request('/jobs/' + key, 'DELETE', token=t)
            except Exception:
                pass
        stopping.set(); sampler.join(timeout=1)


if __name__ == '__main__':
    main()
