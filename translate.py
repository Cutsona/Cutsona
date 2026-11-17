"""Caption translation on this PC, with Argos Translate's open-source models (MIT / CC0, run by CTranslate2).

One JSON request per line: {"id", "texts": [...], "from": "es", "to": "en"}. Language pairs go through English when
there is no direct model (es -> en -> ja). Models download once (about 100 MB per pair) into CUTSONA_TRANSLATE_DIR.
"""
import json
import os
import sys
import urllib.request
import zipfile
from pathlib import Path

INDEX = 'https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json'
ROOT = Path(os.environ.get('CUTSONA_TRANSLATE_DIR') or (Path(__file__).parent / 'bin' / 'translate'))
ROOT.mkdir(parents=True, exist_ok=True)
loaded = {}
index = None
UA = {'User-Agent': 'Cutsona/1.2 (https://github.com/Cutsona/Cutsona)'}


def fetch(url, timeout=60):
    # (the model host turns away Python's default user agent)
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout)


def log(msg):
    print(json.dumps({'log': msg}), flush=True)


def get_index():
    global index
    if index is None:
        cached = ROOT / 'index.json'
        try:
            with fetch(INDEX, 30) as r:
                data = r.read()
            cached.write_bytes(data)
        except Exception:
            if not cached.exists():
                raise
            data = cached.read_bytes()
        index = json.loads(data)
    return index


def pair_dir(f, t):
    d = ROOT / f'{f}_{t}'
    if not (d / 'ready').exists():
        pkg = next((p for p in get_index() if p['from_code'] == f and p['to_code'] == t), None)
        if pkg is None:
            return None
        link = next(l for l in pkg['links'] if l.startswith('http'))
        log(f'Downloading the {pkg["from_name"]} to {pkg["to_name"]} model')
        tmp = ROOT / f'{f}_{t}.zip'
        with fetch(link, 600) as r, open(tmp, 'wb') as out:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
        with zipfile.ZipFile(tmp) as z:
            z.extractall(d)
        tmp.unlink()
        (d / 'ready').write_text('1')
    return d


class Bpe:
    # newer Argos models (1.9+) ship bpe.model + Moses tokenizing instead of a SentencePiece model
    def __init__(self, path, f, t):
        from sacremoses import MosesDetokenizer, MosesPunctNormalizer, MosesTokenizer
        from subword_nmt.apply_bpe import BPE
        self.tok, self.detok, self.norm = MosesTokenizer(f), MosesDetokenizer(t), MosesPunctNormalizer(f)
        with open(path, encoding='utf-8') as fh:
            self.bpe = BPE(fh)

    def encode(self, text):
        words = ' '.join(self.tok.tokenize(self.norm.normalize(text), escape=False)).strip().split(' ')
        return self.bpe.segment_tokens(words)

    def decode(self, toks):
        return self.detok.detokenize(' '.join(toks).replace('@@ ', '').split(' '))


class Spm:
    def __init__(self, path):
        import sentencepiece
        self.sp = sentencepiece.SentencePieceProcessor(model_file=str(path))

    def encode(self, text):
        return self.sp.encode(text, out_type=str)

    def decode(self, toks):
        return self.sp.decode(toks).replace('\u2581', ' ')


def model(f, t):
    key = (f, t)
    if key not in loaded:
        import ctranslate2
        d = pair_dir(f, t)
        if d is None:
            loaded[key] = None
        else:
            # the package folder (one level down) holds model/ (CTranslate2) and the tokenizer model
            base = next((p.parent.parent for p in d.rglob('model.bin') if p.parent.name == 'model'), None)
            if base is None:
                raise ValueError(f'the {f} to {t} model download looks broken (no model.bin); delete {d} and try again')
            if (base / 'sentencepiece.model').exists():
                tk = Spm(base / 'sentencepiece.model')
            elif (base / 'bpe.model').exists():
                tk = Bpe(base / 'bpe.model', f, t)
            else:
                raise ValueError(f'the {f} to {t} model has no tokenizer file')
            threads = max(2, min(8, (os.cpu_count() or 4) - 1))
            loaded[key] = (ctranslate2.Translator(str(base / 'model'), device='cpu', compute_type='int8', inter_threads=1, intra_threads=threads), tk)
    return loaded[key]


def run(texts, f, t):
    m = model(f, t)
    if m is None:
        raise ValueError(f'no model for {f} to {t}')
    tr, tk = m
    toks = [tk.encode(x) for x in texts]
    res = tr.translate_batch(toks, beam_size=2, max_batch_size=32, replace_unknowns=True)
    return [tk.decode(r.hypotheses[0]).strip() for r in res]


def translate(texts, f, t):
    if f == t or not texts:
        return texts
    idx = get_index()
    direct = any(p['from_code'] == f and p['to_code'] == t for p in idx)
    if direct:
        return run(texts, f, t)
    # through English
    mid = texts if f == 'en' else run(texts, f, 'en')
    return mid if t == 'en' else run(mid, 'en', t)


for line in sys.stdin:
    try:
        req = json.loads(line)
        out = translate(req.get('texts') or [], req.get('from') or 'en', req.get('to') or 'en')
        res = {'id': req['id'], 'texts': out}
    except Exception as e:
        res = {'id': req.get('id') if 'req' in locals() else None, 'error': str(e) or type(e).__name__}
    print(json.dumps(res, ensure_ascii=True), flush=True)
