"""Trusted local inference worker. Model directory contains data only, never imported."""
import json
import os
import sys
import time
import wave
import resource


def main():
    import numpy as np
    import sherpa_onnx
    started = time.monotonic()
    with wave.open(sys.argv[1], 'rb') as audio:
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2').astype(np.float32) / 32768
    recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
        paraformer=os.path.join('/models', 'model.int8.onnx'),
        tokens=os.path.join('/models', 'tokens.txt'), num_threads=1,
        sample_rate=16000, feature_dim=80, decoding_method='greedy_search', debug=False,
    )
    stream = recognizer.create_stream()
    stream.accept_waveform(16000, samples)
    recognizer.decode_stream(stream)
    elapsed = time.monotonic() - started
    print(json.dumps({'text': stream.result.text, 'durationSec': len(samples) / 16000,
                      'inferenceSec': elapsed, 'rtf': elapsed / (len(samples) / 16000),
                      'peakRssKiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}, ensure_ascii=False))


if __name__ == '__main__':
    main()
