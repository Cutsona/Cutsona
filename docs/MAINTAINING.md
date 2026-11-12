# Running the Cutsona repo

For the person who publishes Cutsona. Using it is in the [README](../README.md); working on the code is in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Publishing an update
1. Make your changes. Raise `"version"` in `version.json` (for example `1.1.0` → `1.2.0`).
2. Add a section at the top of `CHANGELOG.md` like `## 1.2.0 - Faster search`, then what changed
   (Markdown works: lists, **bold**, links).
3. Double-click **tools\Release.cmd**. It sets the same version in `package.json`, commits, tags `v1.2.0` and pushes.
4. GitHub builds the installer (`.github/workflows/release.yml`, about 10 minutes, under the repo's **Actions** tab)
   and publishes the release `Cutsona 1.2.0` with `Cutsona-Setup-1.2.0.exe` and the notes from CHANGELOG.md.

Everyone with Cutsona installed sees **Update to 1.2.0** the next time they open it (or within a few hours if it's
open), with the notes of every version they're missing. **Update now** downloads the new installer, closes
Cutsona, installs it quietly and opens it again. Their projects, settings and keys are kept.

The updater reads the repo's public Releases, so updates reach people once the repo is public.

## Building the installer on your own PC
`npm install`, then `npm run dist`. The installer lands in `dist\`. `npm run dist` first fetches FFmpeg and
yt-dlp into `vendor\bin` (both git-ignored), which the installer ships with.

## Signing the installer (optional, recommended)
Without a code signature, Windows SmartScreen says "Windows protected your PC" until enough people have
installed Cutsona. A signature removes that. Two ways that cost little or nothing for an open-source app:
- [SignPath Foundation](https://signpath.org) signs open-source projects for free.
- [Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/) costs a few dollars a month.
Either plugs into the release workflow; electron-builder's docs cover the settings.

## Logo
The Cutsona mark is a heavy C sliced once, its top half slid along the cut: a jump cut. It's
gaffer-tape yellow (`#ffc933`) on slate (`#151515`), the same colors as the app.

| File | Use |
| --- | --- |
| `app/brand/icon.svg` | The app icon: header, window and taskbar icon |
| `app/brand/icon-32/192/512.png` | The same icon as PNG |
| `app/brand/mark.svg` | Just the C, yellow, for dark backgrounds |
| `app/brand/mark-ink.svg` | Just the C, near-black, for light backgrounds and print |
| `Cutsona.ico` | The installer, app and shortcut icon |
| `brand/banner.png` | The banner at the top of the README |
| `brand/screenshot.png` | The app screenshot in the README |
| `brand/logo-light.png` | Logo and name on a light background |
| `brand/github-avatar.png` | The organization's profile picture on GitHub |
| `brand/github-social-preview.png` | The image shown when the repo link is shared |
| `brand/cutsona-logo-overview.png` | Every icon size and logo version on one sheet |

On GitHub: the organization's **Settings → Profile picture** takes `github-avatar.png`, and the
repo's **Settings → General → Social preview** takes `github-social-preview.png`.
