"""Local word timing for source video, shared by selection and optional captions.

One JSON request/response per line keeps the Whisper model loaded between clips.
"""
import json
import os
import sys
from pathlib import Path

os.environ.setdefault('HF_HUB_DISABLE_SYMLINKS_WARNING', '1')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
model = None

for line in sys.stdin:
    try:
        request = json.loads(line)
        if model is None:
            from faster_whisper import WhisperModel
            model = WhisperModel(request.get('model') or 'base.en', device='cpu', compute_type='int8',
                                 cpu_threads=4, download_root=os.environ.get('CUTSONA_WHISPER_DIR') or str(Path(__file__).parent / 'bin' / 'whisper'))
        segments, info = model.transcribe(request['audio'], beam_size=5, word_timestamps=True,
                                          vad_filter=True, condition_on_previous_text=False)
        words = []
        for segment in segments:
            if segment.no_speech_prob > 0.7:
                continue
            for word in segment.words or []:
                text = word.word.strip()
                if text and word.end > word.start and word.probability >= 0.15:
                    start = max(words[-1]['end'] if words else 0, float(word.start))
                    if word.end > start:
                        words.append({'text': text, 'start': round(start, 3), 'end': round(word.end, 3)})
        result = {'id': request['id'], 'words': words, 'language': info.language}
    except Exception as error:
        result = {'id': request.get('id') if 'request' in locals() else None,
                  'error': str(error)}
    print(json.dumps(result, ensure_ascii=True), flush=True)
