import { defineConfig } from "tsdown";

const id = "dsh-session-manager";
const externals = new Set([
  "react",
  "react/jsx-runtime",
  "react-dom",
  "@deepseek-ai/dsh-client-ui-primitives",
]);

export default defineConfig({
  name: `${id}/client`,
  entry: { client: "src/client/index.jsx" },
  outDir: "lib",
  format: "cjs",
  platform: "browser",
  target: "es2022",
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: (s) => externals.has(s),
    alwaysBundle: (s) => !externals.has(s),
  },
  outputOptions: {
    entryFileNames: "client.js",
    sourcemapExcludeSources: true,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: "return module.exports; } });",
    intro: "var module = { exports: {} }; var exports = module.exports;",
  },
});
