// Time Clone: delayed copies of you step out to your left and right, a chorus
// line where each copy is a moment behind the last — like a chronophotograph.
// Composed the SDK's way for portrait segmentation — one ScreenSpaceUI:
//
//   renderOrder 0    background — the camera, lightly dimmed and blurred
//   renderOrder 50   clones     — one full-screen plane drawing the delayed copies
//   renderOrder 100  you        — PersonCutout, live and on top
//   renderOrder 150  vignette   — soft darkening toward the corners
//
// History: at 12 fps the camera frame is captured into one layer of a texture
// array (a ring of 28), with the person mask in its alpha. The clone plane
// samples up to 8 layers — clone k is k × 0.25 s old — oldest at the back, each
// cut out by its own stored mask, shifted sideways (alternating left / right,
// each pair further out) and given a light rim inside its edge so overlapping
// copies read apart. Feed space equals screen UV (the SDK
// cover-crops and mirrors the camera texture), so one UV addresses camera, mask
// and history alike. Clones are real, full-colour copies. The clone plane is a custom
// mesh rather than a ScreenImage because ScreenImage shows render-target
// textures blank; the background is one too, for its blur.
//
// More clones when you move: the share of the silhouette changing per second
// (motion.ts) sets how many clones are out; each new one fades in. A jump or a
// very fast move fires a burst (burst.ts): the fan throws wider and springs
// back.
import { Suspense, useEffect, useMemo, useRef } from "react";
import {
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Color,
  type Texture,
  Vector2,
  WebGLArrayRenderTarget,
} from "three";
import { useFrame, useThree } from "@react-three/fiber";
import {
  PersonCutout,
  ScreenSpaceUI,
  usePersonMaskTexture,
} from "@vincentt-xr/sdk";
import { useXRCameraTexture } from "@vincentt-xr/sdk/low-level";
import { usePersonMask } from "@vincentt-xr/sdk/tracking";

import { createBurst, fanOffset, stepBurst } from "./burst";
import {
  BACKGROUND,
  CLONES,
  VIGNETTE,
  HISTORY,
  MASK,
  MOTION,
  RIM,
} from "./config";
import { createMotion, updateMotion } from "./motion";
import { createTimeline, nextCapture, pickClones } from "./timeline";

/** Live state for the prompt and the dev hook. */
export const clonesState = {
  maskReady: false,
  /** Occupied motion-grid cells (0: nobody in view). */
  active: 0,
  pulse: 0,
  /** Clones out right now (fractional while one fades in or out). */
  count: 0,
  /** Bursts fired so far. */
  bursts: 0,
};

// Shaders run as GLSL ES 3.0 (three's default on WebGL2), so `texture()` and
// sampler2DArray work without the GLSL3 flag.
const SRGB = /* glsl */ `
  vec3 toSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  vec3 fromSrgb(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
`;

/**
 * Capture: camera colour (stored sRGB-encoded, so 8 bits keep the shadows) and
 * the person mask (green channel) in alpha.
 */
const captureFrag = /* glsl */ `
  uniform sampler2D uCamera;
  uniform sampler2D uMask;
  uniform float uCameraLinear;
  uniform float uHasMask;
  varying vec2 vUv;
  ${SRGB}
  void main() {
    vec3 c = texture(uCamera, vUv).rgb;
    if (uCameraLinear > 0.5) c = toSrgb(c);
    float m = uHasMask > 0.5 ? texture(uMask, vUv).g : 0.0;
    gl_FragColor = vec4(c, m);
  }
`;

/**
 * The clones, oldest first, each cut out by its own mask; premultiplied output.
 * - Each mask is eroded (the minimum over a small ring): the segmenter lags the
 *   camera a little, so a moving edge's mask holds a sliver of the room, which
 *   shows as a bright fringe on every clone.
 * - Rim: where a wider ring already leaves the clone, the pixel is near its
 *   edge and is lit in the rim colour.
 * - A burst shifts clone k sideways by `uOffset[k]` (share of the width).
 */
const clonesFrag = /* glsl */ `
  precision highp sampler2DArray;
  uniform sampler2DArray uHistory;
  uniform float uLayer[${CLONES.max}];
  uniform float uWeight[${CLONES.max}];
  uniform float uOffset[${CLONES.max}];
  uniform vec2 uEdge;
  uniform vec2 uErode;
  uniform vec2 uRimReach;
  uniform vec3 uRimColor;
  uniform float uRimStrength;
  varying vec2 vUv;
  ${SRGB}
  float ringMin(vec2 uv, float layer, float m, vec2 r) {
    for (int j = 0; j < 6; j++) {
      float ang = float(j) * 1.0471976;
      m = min(m, texture(uHistory, vec3(uv + vec2(cos(ang), sin(ang)) * r, layer)).a);
    }
    return m;
  }
  void main() {
    vec4 acc = vec4(0.0);
    for (int i = ${CLONES.max - 1}; i >= 0; i--) {
      float w = uWeight[i];
      if (w <= 0.0) continue;
      vec2 uv = vUv - vec2(uOffset[i], 0.0);
      if (uv.x < 0.0 || uv.x > 1.0) continue;
      vec4 s = texture(uHistory, vec3(uv, uLayer[i]));
      // Clearly background here: skip the ring taps (most of the screen).
      if (s.a <= uEdge.x) continue;
      float body = ringMin(uv, uLayer[i], s.a, uErode);
      float a = smoothstep(uEdge.x, uEdge.y, body) * w;
      if (a <= 0.0) continue;
      float inner = ringMin(uv, uLayer[i], body, uRimReach);
      float rim = 1.0 - smoothstep(uEdge.x, uEdge.y, inner);
      vec3 col = mix(fromSrgb(s.rgb), uRimColor, rim * uRimStrength);
      acc.rgb = col * a + acc.rgb * (1.0 - a);
      acc.a = a + acc.a * (1.0 - a);
    }
    gl_FragColor = acc;
    #include <colorspace_fragment>
  }
`;

/**
 * The room: the camera, blurred with a 16-tap golden-angle disk (radius in UV
 * per axis) and dimmed by the tint. Decoded to linear like the clones.
 */
const backgroundFrag = /* glsl */ `
  uniform sampler2D uCamera;
  uniform float uCameraLinear;
  uniform vec2 uRadius;
  uniform vec3 uTint;
  varying vec2 vUv;
  ${SRGB}
  void main() {
    vec3 sum = texture(uCamera, vUv).rgb;
    float n = 1.0;
    for (int i = 1; i < 16; i++) {
      float r = sqrt(float(i) / 15.0);
      float ang = float(i) * 2.39996;
      sum += texture(uCamera, vUv + vec2(cos(ang), sin(ang)) * r * uRadius).rgb;
      n += 1.0;
    }
    vec3 c = sum / n;
    if (uCameraLinear < 0.5) c = fromSrgb(c);
    gl_FragColor = vec4(c * uTint, 1.0);
    #include <colorspace_fragment>
  }
`;

/** A soft vignette: black toward the corners, premultiplied. */
const vignetteFrag = /* glsl */ `
  uniform float uAspect;
  uniform vec2 uVignette;
  varying vec2 vUv;
  void main() {
    vec2 c = (vUv - 0.5) * vec2(uAspect, 1.0);
    float corner = length(vec2(uAspect, 1.0) * 0.5);
    float v = smoothstep(uVignette.y, 1.0, length(c) / corner) * uVignette.x;
    gl_FragColor = vec4(0.0, 0.0, 0.0, v);
  }
`;

const passVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
/**
 * Full-screen layers draw straight to clip space (a unit plane doubled), not
 * inside a ScreenTransform: its group carries renderOrder 1000, and three sorts
 * by the group's order first, which would put them above PersonCutout whatever
 * their own renderOrder.
 */
const screenVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;

/** An sRGB-tagged texture is decoded to linear when sampled; capture re-encodes it. */
const samplesLinear = (tex: Texture | null | undefined) =>
  !!tex && tex.colorSpace === SRGBColorSpace;

const CloneLayers = () => {
  const { gl, size, scene } = useThree();
  const cameraTexture = useXRCameraTexture();
  const { texture: maskTexture, status } = usePersonMaskTexture();
  const mask = usePersonMask({ maxUpdateFps: MASK.maxUpdateFps });

  const { rt: history, timeline } = useMemo(() => {
    const h = HISTORY.height;
    const w = Math.max(
      2,
      Math.round((h * size.width) / Math.max(1, size.height)),
    );
    const rt = new WebGLArrayRenderTarget(w, h, HISTORY.layers, {
      depthBuffer: false,
    });
    // Stored sRGB-encoded by the capture shader; three must not convert it.
    rt.texture.colorSpace = NoColorSpace;
    // A new history starts empty, with its own timeline.
    return { rt, timeline: createTimeline(HISTORY.layers) };
    // Rebuilt only when the aspect changes noticeably (a rotation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.round((size.width / Math.max(1, size.height)) * 20)]);

  const capture = useMemo(() => {
    const material = new ShaderMaterial({
      uniforms: {
        uCamera: { value: null },
        uMask: { value: null },
        uCameraLinear: { value: 0 },
        uHasMask: { value: 0 },
      },
      vertexShader: passVert,
      fragmentShader: captureFrag,
      depthTest: false,
      depthWrite: false,
    });
    const passScene = new Scene();
    const quad = new Mesh(new PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    passScene.add(quad);
    return {
      scene: passScene,
      camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1),
      material,
      quad,
    };
  }, []);

  const clonesMaterial = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uHistory: { value: null },
          uLayer: { value: new Array(CLONES.max).fill(0) },
          uWeight: { value: new Array(CLONES.max).fill(0) },
          uOffset: { value: new Array(CLONES.max).fill(0) },
          uRimReach: { value: new Vector2() },
          uRimColor: { value: new Color(RIM.color) },
          uRimStrength: { value: RIM.strength },
          uEdge: { value: new Vector2(CLONES.edge[0], CLONES.edge[1]) },
          uErode: { value: new Vector2() },
        },
        vertexShader: screenVert,
        fragmentShader: clonesFrag,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );

  const backgroundMaterial = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uCamera: { value: null },
          uCameraLinear: { value: 0 },
          uRadius: { value: new Vector2() },
          uTint: { value: new Color(BACKGROUND.tint) },
        },
        vertexShader: screenVert,
        fragmentShader: backgroundFrag,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  const vignetteMaterial = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uAspect: { value: 1 },
          uVignette: { value: new Vector2(VIGNETTE.strength, VIGNETTE.start) },
        },
        vertexShader: screenVert,
        fragmentShader: vignetteFrag,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  const burst = useMemo(createBurst, []);

  const motion = useMemo(
    () =>
      createMotion(
        MOTION.columns,
        Math.round((MOTION.columns * size.height) / Math.max(1, size.width)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const lastMask = useRef({ version: -1, at: 0 });

  useEffect(() => () => history.dispose(), [history]);
  useEffect(
    () => () => {
      capture.material.dispose();
      capture.quad.geometry.dispose();
      clonesMaterial.dispose();
      vignetteMaterial.dispose();
      backgroundMaterial.dispose();
    },
    [capture, clonesMaterial, vignetteMaterial, backgroundMaterial],
  );

  // Dev hook for inspecting the clones live.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __clones?: unknown }).__clones = {
        state: clonesState,
        timeline,
        motion,
        burst,
        history,
        gl,
        scene,
        materials: {
          capture: capture.material,
          clones: clonesMaterial,
          vignette: vignetteMaterial,
        },
      };
    }
  }, [
    timeline,
    motion,
    burst,
    history,
    gl,
    scene,
    capture,
    clonesMaterial,
    vignetteMaterial,
  ]);

  useFrame((state, dt) => {
    const now = state.clock.elapsedTime;
    const maskReady = !!maskTexture && status === "ready";
    clonesState.maskReady = maskReady;

    // Movement → how many clones are out.
    const personIndex = mask.labels.indexOf("person");
    if (
      mask.version > 0 &&
      mask.version !== lastMask.current.version &&
      personIndex >= 0
    ) {
      const t = performance.now();
      const since =
        lastMask.current.version < 0 ? 0 : (t - lastMask.current.at) / 1000;
      lastMask.current = { version: mask.version, at: t };
      updateMotion(motion, mask, personIndex, Math.min(since, 0.5));
    }
    clonesState.active = motion.active;
    clonesState.pulse = motion.pulse;
    const target =
      motion.active > 0
        ? CLONES.min + (CLONES.max - CLONES.min) * motion.pulse ** CLONES.curve
        : 0;
    // Clones step out one at a time and step back slower.
    const rate = target > clonesState.count ? CLONES.stepOut : CLONES.stepBack;
    clonesState.count +=
      Math.sign(target - clonesState.count) *
      Math.min(Math.abs(target - clonesState.count), rate * dt);

    // A jump or a very fast move fans the clones out.
    stepBurst(burst, motion.speed, motion.rise, dt);
    clonesState.bursts = burst.count;

    // Capture this frame into the next history layer.
    if (cameraTexture) {
      const layer = nextCapture(timeline, now, HISTORY.fps);
      if (layer >= 0) {
        const u = capture.material.uniforms;
        u.uCamera.value = cameraTexture;
        u.uMask.value = maskTexture;
        u.uCameraLinear.value = samplesLinear(cameraTexture) ? 1 : 0;
        u.uHasMask.value = maskReady ? 1 : 0;
        const prev = gl.getRenderTarget();
        gl.setRenderTarget(history, layer);
        gl.render(capture.scene, capture.camera);
        gl.setRenderTarget(prev);
      }
    }

    // Which frame each clone shows.
    const pick = pickClones(
      timeline,
      now,
      clonesState.count,
      CLONES.spacing,
      CLONES.max,
    );
    const u = clonesMaterial.uniforms;
    u.uHistory.value = history.texture;
    u.uRimReach.value.set(
      (CLONES.erode + RIM.width) / history.width,
      (CLONES.erode + RIM.width) / history.height,
    );
    u.uErode.value.set(
      CLONES.erode / history.width,
      CLONES.erode / history.height,
    );
    for (let i = 0; i < CLONES.max; i++) {
      u.uLayer.value[i] = pick.layers[i];
      u.uWeight.value[i] = maskReady ? pick.weights[i] : 0;
      u.uOffset.value[i] = fanOffset(i + 1, burst.value);
    }

    const bg = backgroundMaterial.uniforms;
    bg.uCamera.value = cameraTexture;
    bg.uCameraLinear.value = samplesLinear(cameraTexture) ? 1 : 0;
    const blur = BACKGROUND.blur / 1280;
    bg.uRadius.value.set((blur * size.height) / Math.max(1, size.width), blur);

    const f = vignetteMaterial.uniforms;
    f.uAspect.value = size.width / Math.max(1, size.height);
  }, -0.5);

  return (
    <ScreenSpaceUI>
      {cameraTexture ? (
        <mesh
          material={backgroundMaterial}
          renderOrder={0}
          frustumCulled={false}
        >
          <planeGeometry args={[1, 1]} />
        </mesh>
      ) : null}
      <mesh material={clonesMaterial} renderOrder={50} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      {/* The live you, on top of its own clones (default feather / erode). */}
      <PersonCutout name="timeClonePerson" renderOrder={100} />
      <mesh material={vignetteMaterial} renderOrder={150} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </ScreenSpaceUI>
  );
};

export const Clones = () => (
  // PersonCutout loads a default image through a suspending loader
  // even when given a texture; mounted mid-session they need their own boundary.
  <Suspense fallback={null}>
    <CloneLayers />
  </Suspense>
);
