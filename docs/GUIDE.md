# Cutsona guide

For the Windows installer and PowerShell commands, see [Install on Windows](../README.md#install-on-windows).

## Modes

- **Edit Mode** creates beat-synced takes from your clips and song. Use the timeline to refine cuts, framing, keyframes, captions, and fades.
- **Clipper Mode** makes highlights from Twitch and Kick clips, with portrait layouts, facecam framing, and caption controls.
- **Quick Mode → Topic to video** builds a narrated video from a topic or your own script. Set the length, voice, pictures, music, captions, and filter in the left sidebar. After the takes are ready, use the timeline to swap footage or update captions. The right sidebar lists your saved Quick projects.
- **Quick Mode → Long video to clips** takes a source from Find Clips, a local file, or a pasted link. Choose the highlight length and layout, preview the results, and export one or all of them in the same tab.

## Opening Cutsona
Use the Cutsona shortcut on your Desktop or Start menu. Cutsona is one window: its engine (searching, downloading,
saving videos) runs inside the app and stops when you close it. Opening Cutsona again while it's open brings up
the window you have.

Where things are kept:
- **Finished videos**: `Videos\Cutsona`, or any folder you pick in **Settings**.
- **Projects, downloads and settings**: `%APPDATA%\Cutsona`. What the engine prints goes to `cutsona.log` there,
  handy when something goes wrong. Uninstalling Cutsona leaves this folder, so reinstalling keeps your projects.
- **Run from the source code** (`npm start`), everything stays inside the code folder instead.

**Settings → Credits** lists the open-source tools Cutsona is built on.

## Projects and undo
- **Save** with Ctrl+S, or open **Projects** from the project name at the top. The first save names the project
  after your first clip; type a new name any time. After that it saves itself a few seconds after each change.
- A project keeps your clips (even ones from your own PC), the song, every setting, each take's style and
  keyframes, deleted and replaced cuts, and the exact cuts on screen. Opening it shows the takes as you left them.
- **New project** starts over (it asks first if the current one isn't saved). **Save as a copy** branches off.
- **Undo / Redo** (Ctrl+Z / Ctrl+Y, or the arrows at the top) go back through everything you changed: settings,
  takes, trims, framing, the song window, even a clip or take you removed.

## Features
* **Settings** (gear, top right): the folder finished videos save to (Choose folder…, or type a
  path), Dark / Light / Match Windows theme, and the accent color (any color, not just yellow).
  The folder choice is kept in `cutsona-settings.json`; the look is kept in the browser.
* **Copyright check**: clips and songs show badges for their source and license information.
  It goes by where each one came from and its license, and asks YouTube about its own videos (a Creative
  Commons license, or a released song inside). It can't hear or see the footage, so it's a guide, not a promise.
  Exporting something likely to be claimed shows a heads-up once; it never stops the export.
* **Safe zones** (next to the view buttons): shade where TikTok, Reels or Shorts put their buttons, name and
  caption over a 9:16 video. If the hook text, banner or watermark sits under them, the take says so. The
  shading is only on the previews, never in your video.
* **Clipper Mode → Export all** saves every highlight Cutsona found, one after another.
* **Settings → Check sources** asks every site Find clips and Find songs use for a few results, and shows which
  ones are working, slow or down. When one is down, that's on the site's side, not your PC.
* The edit controls stay greyed out until you add a clip or a song.
* **Hover a clip** in the clip list to see a small preview of it. Search results in Find clips
  preview on hover too.
* **Framing a clip of another shape** (a 16:9 clip in a 9:16 edit): pick **Move & zoom** under the
  clip and drag the box to the part you want to show, with a zoom slider.
* **Formats**: 9:16, 4:5, 1:1, 16:9, 3:4, 4:3, 2:3, 21:9, or a custom ratio.
  **Export quality**: 360p up to 4K, at 30 or 60 fps.
* **Watermark**: text (font, color, style, size, see-through) or a logo picture. Drag it on any take
  to put it anywhere. In Clipper Mode, the Twitch or Kick banner can be dragged too.
* **Timeline**: a time ruler on top, then named rows: **Card** (the take's card-motion keyframes),
  **Camera** (camera-move keyframes inside each cut; a plain bar = a cut with your framing),
  **Song** (beats; pink = drops) and **Cuts** (numbered). Both keyframe rows work the same way:
  double-click the row to add one, drag a ◆ to move it, click it to edit it, Delete keyframe to remove it.
  The line under it says where the playhead is, or what's under the mouse. Fades are drawn as ramps.
  **+ Add clip** puts a new cut after the one at the playhead, from any of your clips or one you pick.
* **Card motion** works like the camera move: **◆ Add keyframe** at the playhead (or double-click the
  Card row), change it with the sliders, drag its ◆ to move it, **Delete keyframe** to remove it.
* **Find songs** is its own window (YouTube → MP3, Free Music Archive, ccMixter, Internet Archive,
  Freesound), separate from Find clips. Hovering a Twitch or Kick clip in Find clips plays it right there.
* **Find clips → Videos** searches any video (or just movies, TV shows or anime). **Viral & News → Viral
  feeds** come from YouTube, and Streamer moments from Twitch + Kick. Reddit isn't used: it blocks apps
  from reading it, and a pasted Reddit link says so and asks for the video's own link instead.
* Errors are written for people: a busy or blocked site says which site and what to do, never an
  HTTP code. YouTube downloads retry once when YouTube refuses a download link.
* **Find clips → Exact moments**: describe a moment and get the exact shot (a second or a few) from
  [thepartwhere.com](https://www.thepartwhere.com/), cut from the original YouTube upload. Its
  describe-search is sometimes down; naming the movie or show (or picking a title) still works.
  YouTube searches show the first results in about a second, then fill in the rest.

## Keys and styles
| Key | Action |
|---|---|
| Space | Play / pause all 4 |
| 1–4 | Choose which edit you hear (clip audio) |
| R | New take of the selected edit |
| G | New takes of all 4 |
| E | Export the selected edit |
| ← → | Seek 1s |

Each card has a style menu (8 styles: Dimension, Velocity, Glitch, Impact, Cinematic, Kaleido,
Strobe, Zoom) and a ⟳ button for a new take.

**Pacing**: Hype = fast cuts on every beat or two. Story = longer shots that keep moments
(better for news / funny clips; turn up "Clip audio").

Export is frame-perfect: every frame is rendered with the same engine as the preview, encoded
with the GPU (WebCodecs H.264) and muxed with ffmpeg.

## How it picks moments
* Clip audio and video are scored across whole source windows, with lead-in and reaction time. Blank frames are penalized and detected scene boundaries guide visual selections.
* Local Whisper finds word and sentence boundaries. Spoken moments keep their order and normal playback speed when clip audio or captions are enabled.
* Effects follow the song's beats and drops inside longer source moments. Source cuts favor speech boundaries; footage never rewinds or loops just to fill the requested length.
* If there is too little usable footage, the edit ends earlier. Add more clips for a longer edit.
* Drag the green window on the song waveform to choose which part of the song is used.

## Auto-focus
Auto-focus checks for both faces and people on every sampled frame. A detected body takes
priority over an isolated face or facecam. It follows the person's center, keeps their bounding
box as the framing target, and resets at scene changes. Tracking does not add a zoom or switch
to fit. CPU detection runs in a background worker so it does not block preview playback.
Overlapping face crops improve detection of small and animated faces. Detection gaps use
anchors from the same shot, and spatial scene-change detection handles dark cuts. Initial
playback waits for framing analysis so the first preview has its subject positioned correctly.
Each crop-able clip also has **Framing → Auto / Move & zoom**; a box you place overrides the
automatic track in both preview and export.

## Smooth previews and framing
Clips get a cached preview copy at up to 960 pixels on the long edge and 30 fps, with frequent
keyframes for fast seeking. The original file stays available for full-quality export.
Continuous footage uses one decoder per edit across beat effects. Previews upload a video
texture only when a new decoded frame arrives, render at up to 30 fps, and stop redrawing
when paused. Canvas resolution adapts to available performance; export settings are independent.

The default **Fill (crop)** framing fills the selected format around the tracked person.
Persistent black borders in source files are trimmed during analysis, and styles no longer
add letterbox bars. The same framing applies to preview and export. **Fit + blur** is available
if you prefer to keep more of a wide shot visible, with blurred video filling the background.

## Captions
**Captions → Off / On** is available in the main controls and each edit's ⚙ panel. Captions
start off in Edit Mode. Each mode shows a sample by the caption style picker. Choose a style such as
Yellow Pop, Pure White Crisp, or Stream Word where available. Edit and Clipper previews and exports use
source-time captions, including during cuts and speed changes. Hook text is an optional title.

Speech analysis runs locally even with captions off, because sentence timing improves clip
selection. Timings are cached by the audio content.

**Settings → Captions and speech → Set up speech tools** installs them once: a Python environment with
`faster-whisper==1.2.1` in `bin\speech`, with `transcription.config.json` pointing at it. It needs Python 3.10 to
3.12 on the PC ([python.org](https://www.python.org/downloads/)). To use your own, set `CUTSONA_PYTHON` to a Python that has
`faster-whisper`, or set `python` in `transcription.config.json`. `CUTSONA_WHISPER_MODEL` or the
config's `model` picks the model: a folder or a Faster Whisper model name. The default is `base.en`
(English, downloaded on first use); `base` handles other languages. If speech analysis isn't available,
Cutsona says so and picks moments from the picture alone. Exporting with captions on reports the
failure instead of leaving them out.

## Tests
Run `node --test tests/*.test.mjs` for tracking, caption timing, speech continuity, source
bounds, scene boundaries, decoder continuity, idle rendering, and all style/speed combinations
on short source clips.

## Legal
Cutsona downloads clips from sites like YouTube, Twitch and Kick for you. Those clips belong to their
owners: posting movie, TV, news or other people's footage can get copyright-claimed or taken down,
and some sites' terms don't allow downloading. You are responsible for what you download and post.
Free stock sources show each clip's license. Exact moments come from thepartwhere.com's public
pages and can stop working if that site changes.
