# Contributing to Cutsona

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Run it from the source code
1. Install [Node.js](https://nodejs.org) (22 or newer) and Git.
2. `git clone https://github.com/Cutsona/Cutsona.git` then `cd Cutsona`
3. `npm install`, then `npm run tools` once (gets FFmpeg and yt-dlp into `vendor/bin`)
4. `npm start` opens Cutsona. Its downloads, projects and exports stay inside the folder (all git-ignored).

`npm test` runs the tests. `npm run dist` builds the Windows installer into `dist/`.

## How it's put together
- `app/` is the whole interface: plain HTML, CSS and JavaScript modules, no build step.
- `server.js` is the engine: search, downloads, FFmpeg, projects. It runs inside the desktop app (`desktop/main.js`),
  or on its own with `npm run server` in a browser.
- `docs/GUIDE.md` explains every feature; `docs/MAINTAINING.md` explains releases.

## Pull requests
- Keep them focused on one change, and run `npm test` first.
- Write interface text the way the app does: plain words, sentence case, saying what happens and what to do.
- By contributing you agree your work is shared under the MIT license.
