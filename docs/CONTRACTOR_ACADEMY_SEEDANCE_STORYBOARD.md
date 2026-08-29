# Contractor Academy — Seedance Storyboard (photoreal, Craig-anchored)

**Approach:** photoreal **Seedance 2.0** image-to-video. Each shot is anchored to an existing consistent-character Craig frame in `client/public/assets/quote-images/` (start image → identity stays locked). Silent b-roll only; **Seed Audio voiceover laid on top**, **ffmpeg** for text/logo overlays. NO lip-synced talking head (known failure mode — see [[project-ugc-video-workflow]]).

**Why Craig, not Joe:** it's Craig's pilot app, and Craig already has 11 house-style frames; Joe has one. Character is swappable by re-pointing `SOURCE` frames.

**Model call shape (per shot):**
```
generate_video  model=seedance_2_0
  medias=[{role:"start_image", value:"<uploaded craig frame media_id>"}]
  prompt="<MOTION prompt below>"
  duration=10  aspect_ratio=9:16   (phone-first — contractor app is mobile)
```
Then per shot: `generate_audio model=seed_audio` with the VO line + one narrator voice, and finally stitch (ffmpeg overlay of text + logo; concatenate).

**Realism rule for image-to-video:** Seedance *extends the existing frame* (continues the depicted action + a slow camera move). Prompts below animate what's already in each source image — they do NOT invent unrelated actions the frame can't support.

---

## Storyboard — "The Standard" module (VO lines from `CONTRACTOR_ACADEMY_STANDARD_MODULE_SCRIPT.md`)

| # | SOURCE frame | MOTION prompt (Seedance) | VO (Seed Audio) | Overlay text |
|---|---|---|---|---|
| 1 | `craig-banner.webp` | Slow push-in on Craig standing ready with toolbag; subtle breathing, slight head turn to camera, warm daylight. | "A Handy job is judged on five things. The whole game: be excellent at everything a normal handyman does badly." | `FIVE THINGS. EVERY TIME.` |
| 2 | `craig-tv-mount.webp` | Craig tightens the final fixing on a wall-mounted TV, gives it a firm check; camera eases in on his hands. | "One. Right first time. The job that was quoted is fully done — no half-finished items, no 'I'll come back for that'." | `1 · RIGHT FIRST TIME` |
| 3 | `craig-estimator.webp` | Craig lowers a clipboard, lifts phone to ear, nods; slight camera drift. | "If the scope changes on site, you agree it with ops before you carry on. Ops sets price and scope. You deliver quality." | `SCOPE CHANGED? → OPS FIRST` |
| 4 | `craig-painting.webp` | Craig wipes an edge clean and steps back to survey a tidy finished wall; camera pans across the clean floor. | "Two. Clean handover. You leave the area cleaner than you found it. The customer never tidies up after you." | `2 · CLEANER THAN YOU FOUND IT` |
| 5 | `craig-estimator.webp` | Craig checks watch then taps out a quick text on phone, calm; gentle push-in. | "Three. Turn up in the window. Running late? The customer and ops know before the slot. A silent no-show never happens." | `3 · LATE WITH WARNING ✓ / NO-SHOW ✗` |
| 6 | `craig-light.webp` | Craig works neatly on a ceiling light indoors, careful and unhurried; slow tilt up. | "Four. Respect the home. Boots managed, careful around children, pets and tenants. In that house, you are the brand." | `4 · YOU ARE THE BRAND` |
| 7 | `craig-guarantee.webp` (or `craig-light`) | Craig pauses, holds up a hand in a 'stop' beat, gestures to phone — flagging a job to ops; steady frame. | "Five. Safe and to spec — a standard you'd accept in your own home. Anything you're not qualified for, you flag, never bodge." | `5 · SAFE & TO SPEC` |
| 8 | `craig-tiling.webp` | Craig raises a phone to photograph freshly-laid tiles (before/during proof); camera over his shoulder to the work. | "Prove it. A wide before shot. A close-up of any damage you did not cause — that protects you. Photograph hidden work before you cover it." | `BEFORE · DURING` |
| 9 | `craig-bathroom.webp` | Slow reveal across a finished, gleaming bathroom; Craig lowers phone after the 'after' shot. | "Then the after — same angle as the before, because the comparison is the proof. No photos, no payment." | `AFTER (same angle) · TIDIED` |
| 10 | `craig-estimator.webp` | Craig holds a firm 'stop' palm to camera, serious; static hold. | "Four things mean stop and call ops first: bigger scope, a job you're not qualified for, anything unsafe, or an off-sheet request." | `STOP & CALL OPS` |
| 11 | `craig-guarantee.webp` | Craig folds arms with a confident nod beside a Handy guarantee badge; warm push-in, hold on logo tag. | "Clear your first three jobs cleanly and you're on the standard flow — and on the path from ad-hoc to Core. The work comes to you." | `3 CLEAN JOBS → CORE` |

*11 shots ≈ 110s. For the explainer-style 12-block/2-min grid, split Block 8 into before + during.*

---

## Production order (responsible spend — 139 credits available)
1. **Upload source frames** → `media_upload` each `craig-*.webp`, keep `media_id`s.
2. **Generate ONE test clip first** (recommend shot 8, tiling — proves identity hold + motion + the photo beat) via `seedance_2_0`, `get_cost:true` preflight first. Review before committing.
3. If good → generate remaining 10 clips (independent, can batch).
4. **Voice:** `list_voices` → pick one narrator (calm UK male to match Craig) → `seed_audio` one take per shot.
5. **Assemble:** ffmpeg — lay each VO over its silent clip, burn overlay text + Handy logo tag, concatenate in order. (Seedance path uses ffmpeg, NOT the explainer_video assembler — that's only for the non-photoreal explainer route.)

## Open decisions before generating
- **Aspect:** 9:16 (phone-first, matches contractor app) — confirm vs 16:9.
- **Scope of run:** just the Standard module first (this storyboard), or also redo the airplane/compliance intro in Seedance photoreal instead of the explainer style?
- **Test-clip green-light:** I'll generate shot 8 only and show you before spending on the full set.
