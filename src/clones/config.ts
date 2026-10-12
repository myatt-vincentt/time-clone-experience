// Tuning for Time Clone.

/** Delayed copies of you, drawn behind the live you. */
export const CLONES = {
  /** Most clones (with full movement) and fewest (standing still). */
  max: 8,
  min: 0,
  /** Delay between one clone and the next (s): wide, like a chronophotograph. */
  spacing: 0.25,
  /** How the count follows movement: count = min + (max − min) · pulse^curve. */
  curve: 0.8,
  /** Clones per second stepping out (each fades in over 1/stepOut s) and back. */
  stepOut: 4,
  stepBack: 2.5,
  /** Mask edge: alpha below `edge[0]` is background, above `edge[1]` is person. */
  edge: [0.45, 0.8] as const,
  /** Mask erosion (history px): trims the room's sliver along a moving edge. */
  erode: 2.5,
};

/** The frame history the clones are drawn from. */
export const HISTORY = {
  /** Frames kept; must cover max × spacing × fps (8 × 0.25 × 12 = 24) with margin. */
  layers: 28,
  /** Capture rate (fps): enough for 0.25 s gaps (each clone within ±1/24 s). */
  fps: 12,
  /** Frame height (px); the width follows the screen's aspect. */
  height: 640,
};

/** Movement from the person mask (see motion.ts). */
export const MOTION = {
  /** Coarse occupancy grid columns (rows follow the screen's aspect). */
  columns: 48,
  /** Share of the silhouette changing per second that counts as full movement. */
  full: 1.2,
  /** Rates (1/s): quick to bring clones out, slow to call them back. */
  attack: 6,
  release: 1.2,
};

/** A light edge inside each clone's outline, so overlapping copies read apart. */
export const RIM = {
  /** Width (history px, inside the eroded edge), colour and strength. */
  width: 2,
  color: "#dce6ff",
  strength: 0.5,
};

/** A soft vignette over the whole picture. */
export const VIGNETTE = {
  /** Darkening at the corners (0..1) and where it starts (0 centre … 1 corner). */
  strength: 0.55,
  start: 0.45,
};

/** The clones step out to the sides: alternating left / right, each pair further out. */
export const FAN = {
  /** Sideways step per clone pair (share of the screen width). */
  step: 0.1,
};

/** Clone burst: a jump or a very fast move throws the fan wider, then it snaps back. */
export const BURST = {
  /** Silhouette change per second (share of it) that counts as "very fast". */
  speed: 3.2,
  /** Upward speed of the body's centre (screen heights per second) that counts as a jump. */
  jump: 0.55,
  /** Extra fan spread at the burst's peak (1 = the resting fan's width again). */
  extra: 0.8,
  /** Kick (1/s), spring frequency (Hz) and damping ratio: out fast, back with a little snap. */
  kick: 18,
  freq: 1.6,
  damping: 0.45,
  /** No new burst for this long (s). */
  cooldown: 1.2,
};

/** The room behind everything: lightly dimmed, softly blurred (shallow focus). */
export const BACKGROUND = {
  /** Multiplies the feed (a light dim that keeps the room's own light). */
  tint: "#a8a6a4",
  /** Blur radius (design px of the 1280-tall screen; 0 = sharp). */
  blur: 7,
};

/** Segmentation mask cadence cap for the movement measure (fps). */
export const MASK = { maxUpdateFps: 24 };
