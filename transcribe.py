"""Local word timing for source video, shared by selection and optional captions.

One JSON request/response per line keeps the Whisper model loaded between clips.
"""
import json
import os
import sys
import wave
from pathlib import Path

os.environ.setdefault('HF_HUB_DISABLE_SYMLINKS_WARNING', '1')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
models = {}


def get_model(name, fallback):
    """An English model (better for English) or a multilingual one (99 languages), loaded once each."""
    if name not in models:
        from faster_whisper import WhisperModel
        root = os.environ.get('CUTSONA_WHISPER_DIR') or str(Path(__file__).parent / 'bin' / 'whisper')
        threads = max(2, min(8, (os.cpu_count() or 4) - 1))
        try:
            models[name] = WhisperModel(name, device='cpu', compute_type='int8', cpu_threads=threads, download_root=root)
        except Exception:
            models[name] = WhisperModel(fallback, device='cpu', compute_type='int8', cpu_threads=threads, download_root=root)
    return models[name]


def is_english_model(name):
    import re
    n = str(name or '').lower().replace('\\', '/')
    return bool(re.search(r'(tiny|base|small|medium)\.en($|[/\\])', n))


def load_wav(path):
    """The WAV Cutsona sends, as 16 kHz mono float samples.

    Reading it here (instead of letting faster-whisper open the file through PyAV) avoids
    'open() got an unexpected keyword argument metadata_errors' with newer PyAV versions.
    """
    import numpy as np
    with wave.open(str(path), 'rb') as w:
        rate, channels, width, frames = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
        raw = w.readframes(frames)
    if width == 2:
        audio = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
    elif width == 4:
        audio = np.frombuffer(raw, dtype='<i4').astype(np.float32) / 2147483648.0
    elif width == 1:
        audio = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise ValueError('Unsupported WAV sample width: %d bytes' % width)
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if rate != 16000 and len(audio):
        n = int(round(len(audio) * 16000 / rate))
        audio = np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)
    return audio

for line in sys.stdin:
    try:
        request = json.loads(line)
        lang = (request.get('lang') or 'auto').lower()
        en_name = request.get('model') or 'small.en'
        if not is_english_model(en_name):
            en_name = 'small.en'
        multi_name = request.get('multi') or 'small'
        audio = request['audio']
        if str(audio).lower().endswith('.wav'):
            audio = load_wav(audio)
            # quiet clips: bring the voice up to a normal level first, so it isn't mistaken for silence
            import numpy as np
            peak = float(np.max(np.abs(audio))) if len(audio) else 0.0
            if 0.0005 < peak < 0.6:
                audio = (audio * (0.6 / peak)).astype(np.float32)
        # catch more of what's said: a gentler voice detector (speech over music, quiet or far-away voices),
        # and keep the words Whisper is less sure about unless the whole line is clearly not speech
        # which language: the one you set, else detected (the multilingual model listens to the first 30 s);
        # English goes to the English model (more accurate), every other language to the multilingual one
        detected, prob = lang, 1.0
        if lang == 'auto':
            m = get_model(multi_name, 'base')
            try:
                detected, prob, _ = m.detect_language(audio)
            except Exception:
                _, info0 = m.transcribe(audio[:16000 * 30], beam_size=1)
                detected, prob = info0.language, info0.language_probability
        model = get_model(en_name, 'base.en') if detected == 'en' else get_model(multi_name, 'base')
        segments, info = model.transcribe(audio, beam_size=5, language=None if detected == 'auto' else detected, word_timestamps=True, vad_filter=True,
                                          vad_parameters={'threshold': 0.3, 'min_silence_duration_ms': 350, 'speech_pad_ms': 350},
                                          condition_on_previous_text=False, no_speech_threshold=0.75,
                                          temperature=[0.0, 0.2, 0.4, 0.6])
        words = []
        for segment in segments:
            if segment.no_speech_prob > 0.85 and segment.avg_logprob < -0.9:
                continue
            for word in segment.words or []:
                text = word.word.strip()
                if text and word.end > word.start and word.probability >= 0.06:
                    start = max(words[-1]['end'] if words else 0, float(word.start))
                    if word.end > start:
                        words.append({'text': text, 'start': round(start, 3), 'end': round(word.end, 3)})
        # where speech starts and stops (Silero VAD, open source): for clean cuts that never clip a word
        speech = []
        try:
            from faster_whisper.vad import get_speech_timestamps, VadOptions
            for ts in get_speech_timestamps(audio, VadOptions(threshold=0.45, min_silence_duration_ms=250, speech_pad_ms=60)):
                speech.append([round(ts['start'] / 16000, 3), round(ts['end'] / 16000, 3)])
        except Exception:
            pass
        result = {'id': request['id'], 'words': words, 'language': detected if detected != 'auto' else info.language,
                  'languageProb': round(float(prob), 3), 'speech': speech}
    except Exception as error:
        result = {'id': request.get('id') if 'request' in locals() else None,
                  'error': str(error)}
    print(json.dumps(result, ensure_ascii=True), flush=True)
