# Cutsona changelog

Write each new version's notes at the top, as `## 1.2.0 - Short title`, then run tools\Release.cmd.
That text is the "What's new" people see in Cutsona before they update.

## 1.2.0 - Quick Mode, clip search and preview improvements

### New
- **Quick Mode → Topic to video.** Start from a topic or your own script. Pick the length, format, voice, music, captions, and filter. Research can draw on sources including Wikipedia, NASA, Crossref, and Europe PMC. Edit up to four takes with a timeline for swapping footage and changing captions.
- **Quick Mode → Long video to clips.** Start with Find Clips, a local video, or a pasted link. Preview and export highlights from the same tab.
- **Saved Quick projects** retain the takes you already made. Open them in Quick Mode, or send their original cuts, narration, music, and captions to Edit Mode or Clipper Mode as an editable project.
- **Viral moments.** See suggested highlights and jump to them in the Find Clips preview or when bringing in your own videos.
- **Find a part.** Paste any video link, type what's said, and every moment it's said shows up with its time. Add exactly that part, as long as you want.
- **Cutsona's own player** in every Find clips preview: no YouTube logo or buttons on top. Search what's said in the video, set a start and an end anywhere, any length, and keep your own length buttons.
- **Transcript** for every clip: click a word to start the clip there, Shift+click to end it. Smart edges keep whole sentences.
- **Photos and videos on top of your takes.** Drag them anywhere, drag the corner to resize, and × removes one from just that take. They're in your exports too.
- **Clip audio:** double-click a clip's wave for its volume (up to 200%), mute, even loudness, bass, treble and fades.
- **Everyone on cam** in Stream clips: two or more faces on the webcam all stay in the shot.
- **Hotkeys you can change** in Settings → Hotkeys.
- **Take size slider** under the timeline, and drag a take by its number to move it anywhere.
- **Safe zones** now look like the real TikTok, Reels and Shorts screens.

### Changed
- The sidebar uses dropdowns (with the filter and banner previews) and one row per setting, so far less scrolling.
- Topic to Video uses the same left sidebar controls, with saved projects and recent exports on the right.
- Caption style samples update in Edit Mode, Clipper Mode, and Quick Mode. Both Quick tabs share the Edit Mode filter picker.
- Find songs is a list of tracks with their sound waves, played right in the list.
- Stream clips: the whole video shows with black bars (or a blurred copy) when you pick Whole screen / Whole video.
- The copyright check is gone from the top bar.

### Fixed
- Imported videos show footage in take previews again, including in saved projects affected by the black-screen bug. The media server closes canceled reads and keeps running if a file read fails.
- Twitch category search handles alternate names and reports when a category cannot be loaded.
- Stream clips no longer show a mirrored copy of the video, and the screen half fills its space again on streams with dark gameplay.
- Scrolling over the timeline, the shot editor or a clip's framing box no longer changes the zoom by accident (Ctrl + scroll zooms).

## 1.1.0 - Desktop app, projects and undo

### New
- **A real Windows app.** Download the installer, open it, and Cutsona is on your Desktop and Start menu. It brings its own FFmpeg and yt-dlp, and updates itself.
- **Projects.** Save an edit and open it again later, exactly as you left it. A named project saves itself after every change.
- **Undo and redo** for everything you change, even a removed clip or take (Ctrl+Z, Ctrl+Y).
- **Copyright check.** Every clip and song shows who owns it and how likely your post is to be muted or claimed, with credits you can copy.
- **Safe zones** for TikTok, Reels and Shorts over the previews, with a warning when your title sits under the app's buttons.
- **Export all** in Stream clips: every highlight Cutsona found, one after another.
- **Settings → Check sources** shows which sites are working right now, and says so when a site is down on its side, not yours.
- **Settings → Captions and speech** sets up captions with one button.

### Changed
- Cutsona is open source under the MIT license.
- No more hidden launcher script or paste-in install command.

## 1.0.0 - First release

The first release of Cutsona.

### New
- Four beat-synced takes from your clips and a song, playing live side by side
- **Find clips**: videos, exact movie moments, Twitch and Kick streamer clips, gaming, viral and news, free stock
- **Find songs**: YouTube to MP3, Free Music Archive, ccMixter, Internet Archive, Freesound
- Timeline with **Card** and **Camera** keyframe rows, fades, and **+ Add clip**
- Watermarks, a movable Twitch / Kick banner, custom formats, 360p to 4K exports
- Settings: export folder, dark / light theme, any accent color, and **Credits**
- Updates: Cutsona tells you when a new version is out and installs it with one click
