# Running the Cutsona repo

For the person who publishes Cutsona. Using it is in the [README](../README.md).

## How updates reach people
Cutsona lives at **Cutsona/Cutsona** on GitHub. The install command in the README downloads it with Git,
and the same Git copy is how each install gets updates.

When a newer version is published, an **Update to x.y.z** button appears at the top of Cutsona. It
shows the changelog (the notes of every version they're missing), and **Update** installs it and
restarts Cutsona. Their clips, settings, API keys, downloads and exports are never touched.
Settings → Updates shows the version and has **Check for updates**.

## Publishing an update
1. Make your changes. Raise `"version"` in `version.json` (for example `1.0.0` → `1.1.0`).
2. Add a section at the top of `CHANGELOG.md` like `## 1.1.0 - Faster search`, then what changed
   (Markdown works: lists, **bold**, links).
3. Double-click **tools\Release.cmd**. It commits, tags `v1.1.0` and pushes.

Everyone on an older version sees the update the next time they open Cutsona (or within a few hours
if it's already open).

## Logo
The Cutsona mark is a heavy C sliced once, its top half slid along the cut: a jump cut. It's
gaffer-tape yellow (`#ffc933`) on slate (`#151515`), the same colors as the app.

| File | Use |
| --- | --- |
| `app/brand/icon.svg` | The app icon: header, window and taskbar icon |
| `app/brand/icon-32/192/512.png` | The same icon as PNG |
| `app/brand/mark.svg` | Just the C, yellow, for dark backgrounds |
| `app/brand/mark-ink.svg` | Just the C, near-black, for light backgrounds and print |
| `Cutsona.ico` | The desktop shortcut icon |
| `brand/banner.png` | The banner at the top of the README |
| `brand/screenshot.png` | The app screenshot in the README |
| `brand/logo-light.png` | Logo and name on a light background |
| `brand/github-avatar.png` | The organization's profile picture on GitHub |
| `brand/github-social-preview.png` | The image shown when the repo link is shared |
| `brand/cutsona-logo-overview.png` | Every icon size and logo version on one sheet |

On GitHub: the organization's **Settings → Profile picture** takes `github-avatar.png`, and the
repo's **Settings → General → Social preview** takes `github-social-preview.png`.
