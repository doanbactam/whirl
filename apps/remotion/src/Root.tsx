import { Composition } from "remotion";

import { HelloWhirl } from "./HelloWhirl";
import {
  TWO_X_LIMITS_DURATION,
  TWO_X_LIMITS_FPS,
  TwoXLimits,
} from "./two-x-limits/TwoXLimits";

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="HelloWhirl"
        component={HelloWhirl}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="TwoXLimits"
        component={TwoXLimits}
        durationInFrames={TWO_X_LIMITS_DURATION}
        fps={TWO_X_LIMITS_FPS}
        width={1200}
        height={800}
      />
    </>
  );
}
