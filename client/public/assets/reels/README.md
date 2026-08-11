# Landing-page vertical reels

Instagram/Reels-style clips shown in `VideoReelsSection` on the handyman landing
page. Rendered by `client/src/components/VerticalReels.tsx`, listed in the
`REELS` array in `client/src/pages/HandymanLanding.tsx`.

## Drop-in
For each clip add two files here with matching names, then add an entry to `REELS`:

```
kitchen-fit.mp4    # the video
kitchen-fit.webp   # first-frame poster (instant paint before video loads)
```

## Encoding specs
- **Aspect:** 9:16 vertical (portrait). 1080×1920 is ideal; the card crops with object-cover.
- **Codec:** H.264 (baseline/main) MP4 + AAC audio → plays everywhere, incl. iOS.
- **Length:** 6–12s loops read best.
- **Size:** keep each file **under ~2–3 MB**. These are lazy-loaded (only fetched
  as the card nears the viewport) and pause off-screen, but small files still win.
- **Audio:** clips autoplay MUTED; sound only plays when the visitor taps the
  speaker button. Make sure the visual works with no sound.

### One-liner to compress an existing vertical clip (ffmpeg)
```bash
ffmpeg -i input.mov -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" \
  -c:v libx264 -profile:v main -crf 26 -preset slow -pix_fmt yuv420p \
  -c:a aac -b:a 96k -movflags +faststart kitchen-fit.mp4

# poster from the first frame
ffmpeg -i kitchen-fit.mp4 -frames:v 1 -q:v 3 kitchen-fit.webp
```
`-movflags +faststart` puts the index at the front so playback can begin before
the whole file downloads.

## Hosting note
These files are committed to the repo and served as static assets (like the quote
images). Fine for short, well-compressed clips. If clips get long/heavy or you
want adaptive bitrate + view analytics, move them to **Cloudflare Stream** (already
in the stack) and point `Reel.src` at the stream URL instead — the component takes
any URL.
