# ⚡ EX Visualizer — Truly Free Video Editor

A CapCut-style **timeline video editor** that is actually free:
✅ No watermark · ✅ No paywall / export limits · ✅ No account · ✅ No uploads (100% local, private)

![status](https://img.shields.io/badge/version-1.0.0-brightgreen) — MVP

## ▶️ Try it right now (browser)
Open the live preview, click **Load Demo**, press Play, then **Export Video — FREE**.

## 🖥️ Run as a desktop app
```bash
npm install
npm start          # opens EX Visualizer as a desktop app (Electron)
```

## 📦 Build the executable (.exe for Windows)
On a Windows PC (Node.js 18+ installed):
```bash
npm install
npm run dist:win
```
The installer + portable `.exe` appear in `dist/` — e.g. `EX Visualizer-1.0.0-win-x64.exe`.
Double-click it and edit. That's it — no licence key, ever.

Other platforms:
```bash
npm run dist:mac    # .dmg
npm run dist:linux  # .AppImage
```

> Building a Windows `.exe` from macOS/Linux needs Wine — easiest is to run `npm run dist:win` on Windows, or use the GitHub Action below.

## 🧊 v1.3.1 fix — frozen / muted parts in exports
Preview was fine but exports could freeze and lose audio mid-clip. Causes: the old
real-time master was recorded with heavyweight VP9 (the encoder could fall behind),
the timeline ran on a wall clock so a decoder stall turned into a forced seek (frozen
frame + audio gap) in the file, and the renderer could be throttled when the window
lost focus. Fixes: the master is now recorded with a cheap codec (H.264 where
available, else VP8) and converted afterwards; during export the playhead follows
the media itself; if a clip stalls, the timeline holds and the **recorder pauses**
instead of burning a frozen/silent stretch into the file; clips are pre-primed
before recording; and the desktop window no longer throttles rendering in the
background (`backgroundThrottling: false`).

## 🎚️ Export settings (v1.3.0)
The export dialog now lets you choose:
- **Quality** — 144p, 240p, 360p, 480p, 720p, 1080p, 1440p, up to **4K (2160p)**. Your project's aspect ratio is kept; upscaling bigger sources is flagged (it can't invent detail).
- **Frame rate** — slider **12–60 fps** (`captureStream(fps)`)
- **Bit rate** — slider **5–45 Mbps** (plus 192 kbps audio), with a rough file-size estimate
- **Format** — `.mp4`, `.mov`, `.webm`, `.mkv`, `.avi`. WebM is recorded natively; MP4 may record natively in recent Chrome/Edge. In the **desktop app**, the other formats are produced by a **real conversion with the FFmpeg binary bundled into the app** (H.264/AAC for mp4/mov/mkv, MPEG-4/MP3 for avi) — never a renamed WebM. In a plain browser, mov/mkv/avi ask you to use the desktop app instead of faking it.

Your last-used settings are remembered. Rebuilding the Windows app from source: download the FFmpeg "essentials" build from gyan.dev, put `ffmpeg.exe` in `resources/`, then run `npm run dist:win` (the binary is bundled via `extraResources`, not committed).

## 📁 Where do exports go? (v1.2.0)
The first time you export, EX Visualizer **makes you choose a folder on your PC**.
Then pick **Export to This Folder** (just this once) or **⭐ Use as Default & Export**
(future exports go straight there — change it any time from the export dialog).
When the render finishes you get a confirmation showing the exact file name and
full location. **A project can be exported unlimited times**: every export gets a
unique name (`my-video-export-1.webm`, `-export-2`, …) and the success dialog has an
**Export Again** button. Since v1.2.2 the desktop app only shows "Export saved"
after **verifying the file exists on disk with the exact rendered size**, shows the
file size, and offers **📂 Show in Folder** to reveal it in Explorer. If saving
fails, you get the real error instead of a false success. On browsers that cannot pick folders, exports fall back to
the browser's Downloads folder and the dialog says so clearly.

## 🏠 Home (default page)
EX Visualizer opens on a Home page: an always-visible **＋ New Project** button in the header,
a big **+** card, and **Your Projects** underneath (auto-saved on this device; open / rename / delete).
Creating a project offers two choices:
- **Blank Project** — empty timeline, add media whenever you're ready.
- **Insert Files** — choose one or more videos/images; they are placed **in order on the main track**.

## 🎬 What you can do in v1
| Feature | Status |
|---|---|
| Multi-track timeline (Video / Text / Audio) | ✅ |
| Import video, image & audio (drag & drop) | ✅ |
| Drag clips, trim with edge handles, move playhead | ✅ |
| Split at playhead (`S`), duplicate, delete (`Del`) | ✅ |
| Play / pause (`Space`), seek, timeline zoom | ✅ |
| Text overlays + big titles (size, colour, position) | ✅ |
| Volume, speed (0.25×–2.5×), trim-start | ✅ |
| Brightness / contrast / saturation + Vivid, B/W, Warm, Cool presets | ✅ |
| Aspect ratios: 16:9, 9:16, 1:1, 4:5 | ✅ |
| **Export video (WebM) — free, no watermark** | ✅ |
| Save / open project (`.EXvid`) | ✅ |

## 🛠️ v1.0.1 fix — exported video stretched / cropped
**Cause:** v1 always used "cover" scaling onto a fixed 1280×720 canvas, so any source
with a different aspect ratio was zoomed/cropped (and looked altered on export).
**Fix:** default is now **Fit (contain)** — the whole source is always visible, never
distorted; the canvas auto-matches your first clip's exact size/shape; per-clip
**Fit / Fill / Stretch** and a **Match canvas to this clip** button are in Properties.

## ⚠️ Honest MVP limits (roadmap)
- Export is **real-time** (a 60s video renders in ~60s) and outputs **WebM**. In Chromium/Electron WebM plays everywhere modern; convert to MP4 later with the planned FFmpeg export.
- Large 4K files depend on your PC/GPU decoding in Chromium.
- Project files can't embed your local video files (browser security) — keep originals nearby.

## 🗺️ Roadmap ideas
Native FFmpeg export to MP4 (fast, not real-time) · transitions · stickers/emoji track · auto-captions · keyframes · more audio tools · template library.

## Tech
Vanilla JS + Canvas preview/render engine + MediaRecorder export, wrapped in Electron. No build step, no backend, no tracking.
