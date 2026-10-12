# Plan — Time Clone

The user's request (2026-10-12): **Time Clones** — copies of you trailing behind on a delay, so
every move becomes a chorus. There is no Brief.md.

## Decisions (the user's answers)

- **Layout:** in place (echo) at first; the user found the clones "stuck on each other", so they
  now **stand beside you**: alternating left / right, each pair 10 % of the width further out
  (the spread the burst used to reach). A burst throws the fan 1.8× wider and snaps it back.
- **Look:** **real copies** — exact delayed copies, full colour (a ghost style was tried and
  removed at the user's request).
- **Background:** dimmed camera at first; from the thumbnail review it is a **brighter room
  with a soft blur** (shallow focus).
- **Controls:** **more clones when you move** (standing still shows none; they step out as you move).
- **Improvements picked (round 1):** **rim light** on each clone, a **chronophotography look**
  (0.25 s apart, vignette; the grain was later removed) and a **clone burst** on a jump or very fast move.
- **Thumbnail review (round 2):** of the gaps found against `public/images/time-clone-thumbnail.jpg`,
  the user kept the **brighter, blurred room**; ghostly clones were tried and removed, and the film
  grain was removed too (the vignette stays).
- **Preview:** the dev media switcher starts on the SDK's built-in "Person Fullbody" video, so a
  fresh clone needs no clip. An optional local clip at `dev-media/dancing.mp4` (the user's dance
  clip from Wings) is listed first and used instead; it is git-ignored and never ships.

## Composition

| renderOrder | Layer      | What                                                    |
| ----------- | ---------- | ------------------------------------------------------- |
| 0           | background | camera, 16-tap disk blur (7 px), tinted `#a8a6a4`       |
| 50          | clones     | one full-screen shader plane drawing the delayed copies |
| 100         | you        | `PersonCutout`, live, on top of its own clones          |
| 150         | vignette   | soft darkening toward the corners (premultiplied)       |

## Pipeline

1. **Capture** (12 fps cap — enough for 0.25 s gaps): the camera frame goes into the next layer
   of a ring of 28 in a `WebGLArrayRenderTarget` (360 × 640, RGBA8; ≈ 26 MB), colour stored sRGB-encoded so 8 bits
   keep the shadows, and the person mask (green channel) in alpha. Feed space = screen UV, so one
   UV addresses camera, mask and history.
2. **Timeline** (`timeline.ts`, pure, tested): each layer's capture time; clone k (1 = newest)
   shows the layer captured closest to `now − k × 0.25 s` (within one gap, never repeating the previous clone's frame), so delays hold at any frame rate. A
   clone older than the history (just after start) is hidden.
3. **Count** (`motion.ts`, pure, tested): a 48-column occupancy grid of the CPU person mask; the
   share of the silhouette changing per second, smoothed (quick attack, slow release), is the
   pulse. `count = 8 · pulse^0.8`, eased; the fractional part fades the newest clone in/out.
4. **Draw** (one pass): oldest clone first, each cut out by its own stored mask, eroded by a
   2.5 px minimum ring (the segmenter lags the camera, so a moving edge's mask holds a sliver of
   the room); the ring taps are skipped where the clone is clearly background. **Rim:** a second,
   wider ring (+2 px) finds pixels near the clone's edge, lit `#dce6ff` at 0.5 so overlapping
   copies read apart. Output is premultiplied, decoded to linear, then three's colour-space output.
5. **Burst** (`burst.ts`, pure, tested): fires when the silhouette changes faster than 3.2× its
   size per second or the body's centre rises faster than 0.55 screen heights per second (a jump;
   smoothed, and ignored on frames where the silhouette's size jumps, e.g. stepping in), with a
   1.2 s cooldown. It kicks a damped spring (1.6 Hz, ζ 0.45) that peaks near 1 and snaps back a
   little past rest. Clone k always stands `±ceil(k/2) × 0.1` of the width to the side
   (alternating), times `1 + 0.8 × burst`, so a burst widens the chorus line.
6. **Vignette**: from 45 % of the way to the corner, up to 55 % darker.
7. **Prompts**: "Move to bring out your clones" until 3 are out, then once "Jump for a clone
   burst" until the first burst.

## Notes

- **Draw order trap:** a `ScreenTransform` group carries `renderOrder` 1000, and three sorts by
  the group's order before the mesh's own. A full-screen plane inside one draws after
  `PersonCutout` whatever its renderOrder, so the clones were painted over the live person. The
  full-screen layers here are plain quads drawn straight to clip space, outside any
  `ScreenTransform`.

- Shaders run as GLSL ES 3.0 (three's default on WebGL2), so `sampler2DArray` / `texture()`
  work without the GLSL3 flag and its missing-output trap.
- The clone plane is a custom mesh: `ScreenImage` shows render-target textures blank.
- On the dance clip a burst fires about once in 25 s, on her biggest moves (dancing peaks at
  ≈ 2.6 silhouettes/s); a real jump crosses the rise threshold.
- The built-in preview renders at ~1 fps, so clone spacing there isn't representative; check
  smoothness and GPU cost on a phone.

## Production

- The dev media switcher and the `window.__clones` hook are dev-only (inline `NODE_ENV` guards).
