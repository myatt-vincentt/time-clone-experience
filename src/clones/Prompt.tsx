// One quiet line at the bottom: while the segmentation model loads, when nobody
// is in view, a "move" hint until the clones first come out, then a "jump" hint
// until the first burst.
import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { ScreenSpaceUI, ScreenText } from "@vincentt-xr/sdk";
import { useXRReady } from "@vincentt-xr/sdk/low-level";

import { clonesState } from "./Clones";

/** Fewer active grid cells than this for this long → "Step into the frame". */
const MIN_CELLS = 30;
const AFTER = 1.2;
/** The hint shows after this long in view, until this many clones have come out. */
const HINT_AFTER = 1.5;
const HINT_UNTIL = 3;
/** The burst hint shows this long after the clones came out, for `BURST_HINT_FOR`. */
const BURST_HINT_AFTER = 5;
const BURST_HINT_FOR = 4;

export const Prompt = () => {
  const cameraReady = useXRReady();
  const [text, setText] = useState("");
  const empty = useRef(0);
  const seen = useRef(0);
  const discovered = useRef(false);
  /** Seconds in view since the clones first came out. */
  const sinceDiscovered = useRef(0);

  useFrame((_s, dt) => {
    const inView = clonesState.active >= MIN_CELLS;
    empty.current = inView ? 0 : empty.current + dt;
    if (inView) seen.current += dt;
    if (clonesState.count >= HINT_UNTIL) discovered.current = true;
    if (discovered.current && inView) sinceDiscovered.current += dt;
    const burstHint =
      clonesState.bursts === 0 &&
      sinceDiscovered.current > BURST_HINT_AFTER &&
      sinceDiscovered.current < BURST_HINT_AFTER + BURST_HINT_FOR;
    let next = "";
    if (cameraReady && !clonesState.maskReady) next = "Finding you…";
    else if (cameraReady && empty.current > AFTER) next = "Step into the frame";
    else if (!discovered.current && seen.current > HINT_AFTER)
      next = "Move to bring out your clones";
    else if (burstHint) next = "Jump for a clone burst";
    if (next !== text) setText(next);
  });

  if (!text) return null;
  return (
    <ScreenSpaceUI>
      <ScreenText
        name="timeClonePrompt"
        text={text}
        screenTransform={{
          position: { x: 0, y: -560 },
          size: { width: 640, height: 70 },
          renderOrder: 200,
          overlay: true,
        }}
        textAlign="center"
        verticalAlign="center"
        fontFamily='system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
        fontWeight={600}
        fontSize={30}
        resolution={150}
        letterSpacing={0.04}
        color="rgba(240,242,248,0.85)"
        bgColor="transparent"
      />
    </ScreenSpaceUI>
  );
};
