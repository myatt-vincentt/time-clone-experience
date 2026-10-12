// Scene.tsx — Time Clone: delayed copies of you echo every move, on a dimmed
// camera; the more you move, the more clones come out. See PLAN.md.
import { lazy, Suspense } from "react";

import { Clones } from "./clones/Clones";
import { ExperienceStatus } from "./clones/ExperienceStatus";
import { Prompt } from "./clones/Prompt";

// Dev-only media switcher (SDK sample media, an optional local clip, webcam) for
// previewing without a camera. Lazy and behind a constant esbuild folds to false
// in production. Two rules: `process.env.NODE_ENV`, not `import.meta.env.DEV`
// (vincentt-xr/v2-template#112); and write the check INSIDE the ternary —
// hoisted into a `const`, esbuild keeps the dead branch.
const DevMediaSwitcher =
  process.env.NODE_ENV !== "production"
    ? lazy(() => import("./DevMediaSwitcher"))
    : null;

export const Scene = () => (
  <>
    <ExperienceStatus />
    <Clones />
    <Prompt />
    {DevMediaSwitcher ? (
      <Suspense fallback={null}>
        <DevMediaSwitcher />
      </Suspense>
    ) : null}
  </>
);
