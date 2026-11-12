# Cutsona guide

Everything Cutsona does, in more detail. For installing, see the [README](../README.md).

## Opening Cutsona
Use the Cutsona shortcut on your Desktop or Start menu (or double-click **Cutsona.vbs** in its folder).
Cutsona opens in its own window with no console: its engine runs in the background and closes itself
a few seconds after you close the Cutsona window. Opening Cutsona again while it's running just brings up
its window. What the engine prints goes to `cutsona.log`. Exports go to the `exports` folder, or any
folder you pick in **Settings**. **Settings → Credits** lists the open-source tools Cutsona is built on.

## Features
* **Settings** (gear, top right): the folder finished videos save to (Choose folder…, or type a
  path), Dark / Light / Match Windows theme, and the accent color (any color, not just yellow).
  The folder choice is kept in `cutsona-settings.json`; the look is kept in the browser.
* The edit controls stay greyed out until you add a clip or a song.
* **Hover a clip** in the clip list to see a small preview of it. Search results in Find clips
  preview on hover too.
* **Framing a clip of another shape** (a 16:9 clip in a 9:16 edit): pick **Move & zoom** under the
  clip and drag the box to the part you want to show, with a zoom slider.
* **Formats**: 9:16, 4:5, 1:1, 16:9, 3:4, 4:3, 2:3, 21:9, or a custom ratio.
  **Export quality**: 360p up to 4K, at 30 or 60 fps.
* **Watermark**: text (font, color, style, size, see-through) or a logo picture. Drag it on any take
  to put it anywhere. In Stream clips, the Twitch / Kick banner can be dragged anywhere too.
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
start off. When enabled, they use short phrases (up to five words), a bold outline, and timed
word highlights inspired by GitHubReelMaker. Choose Yellow Pop, Cyan, or White. Preview and
export use the same source-time captions, including during cuts and speed changes. Hook text
remains a separate optional title.

Speech analysis runs locally even with captions off, because sentence timing improves clip
selection. Timings are cached by the audio content.

The installer sets up the speech tools (Python with `faster-whisper==1.2.1` in `bin\speech`) and
points `transcription.config.json` at them. To use your own, set `CUTSONA_PYTHON` to a Python that has
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
