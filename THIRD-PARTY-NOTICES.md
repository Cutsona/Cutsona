# Third-party software

Cutsona's own code is under the MIT license (see [LICENSE](LICENSE)). It uses the software below, which keeps
its own license. **Settings → Credits** in Cutsona lists the same projects with links.

## Included in this repository
- **mp4-muxer** (MIT): `app/js/vendor/mp4-muxer.mjs`, license in `app/js/vendor/mp4-muxer.LICENSE`.
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
