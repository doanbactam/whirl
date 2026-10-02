import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

import { pinEsbuildTsconfig } from "./config/pin-esbuild-tsconfig";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig((config) =>
  pinEsbuildTsconfig(enableTailwind(config)),
);
