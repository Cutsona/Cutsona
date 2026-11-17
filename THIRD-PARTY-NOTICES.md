# Third-party software

Cutsona's own code is under the MIT license (see [LICENSE](LICENSE)). It uses the software below, which keeps
its own license. **Settings → Credits** in Cutsona lists the same projects with links.

## Included in this repository
- **mp4-muxer** (MIT): `app/js/vendor/mp4-muxer.mjs`, license in `app/js/vendor/mp4-muxer.LICENSE`.
- **[Face-API](https://github.com/vladmandic/face-api)** 1.7.15 and its face recognition model (MIT) distinguish people within a clip. The browser bundle uses **[TensorFlow.js](https://github.com/tensorflow/tfjs)** (Apache 2.0). Both licenses are in `app/js/vendor/faceapi/`.
- **Archivo** typeface by Omnibus-Type (SIL Open Font License 1.1): `app/fonts/`, license in `app/fonts/Archivo-OFL.txt`.

## Shipped with the Windows installer
- **Electron** (MIT), which includes **Chromium** (BSD-style) and **Node.js** (MIT): the Cutsona window and engine.
- **electron-updater** (MIT): installs new versions of Cutsona from GitHub Releases.
- **FFmpeg** (GPL v3 build from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/)): reads, converts and saves video
  and audio. It runs as a separate program; their license and where to get their source code are in the
  installed `resources/bin` folder (`FFmpeg-LICENSE.txt`, `FFmpeg-SOURCE.txt`). Source: https://github.com/FFmpeg/FFmpeg
- **yt-dlp** (Unlicense): downloads clips and songs from the sites in Find clips and Find songs.

## Downloaded when you use them
- **MediaPipe** face and person detection models (Apache 2.0), for auto-framing.
- **faster-whisper** (MIT), **CTranslate2** (MIT) and the **Whisper** model (MIT), set up from Settings → Captions and speech.
- **Python** (PSF license), which runs faster-whisper. You install it yourself if you want captions.

Clips and songs you find with Cutsona belong to the people who made them: see the Copyright check in the app.

## Downloaded on first use (not shipped in the installer)

- **YAMNet** sound classifier (Google), through **MediaPipe Tasks Audio**: Apache License 2.0.
- **MediaPipe Face Landmarker** (Google): Apache License 2.0.
- **VADER** sentiment lexicon (C.J. Hutto): MIT License.
- **Silero VAD** (Silero Team), as bundled in faster-whisper: MIT License.
- **Argos Translate** language models (Argos Open Technologies), run with **CTranslate2** and **SentencePiece**: models CC0 / MIT; CTranslate2 MIT; SentencePiece Apache 2.0.
- **PySceneDetect** (Brandon Castellano): BSD 3-Clause License; **OpenCV**: Apache License 2.0.
- **Piper** text-to-speech (Rhasspy) and its voices *en_US-ryan-high* and *en_US-lessac-medium*: Piper MIT License; voices per their model cards (Hugging Face rhasspy/piper-voices).
- **Film looks**: HaldCLUT film emulations from the G'MIC / RawTherapee film simulation collection (Pat David and contributors), CC BY-SA 4.0. Film stock names are used only to describe the look; no affiliation with or endorsement by their trademark owners.
- **Pictures for Topic to video**: Wikipedia / Wikimedia Commons (each file under its own license, mostly CC BY-SA or public domain); scripts from Wikipedia text, CC BY-SA 4.0.
