import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The OpenNext build output and the wrangler local state are generated.
    // .open-next/ contains a full copy of the Next.js runtime, so linting it
    // exhausts memory rather than reporting a style problem.
    ".open-next/**",
    ".wrangler/**",
    "worker-configuration.d.ts",
  ]),
]);

export default eslintConfig;
