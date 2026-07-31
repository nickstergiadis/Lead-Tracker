export default [
  { ignores: ["dist/**", "node_modules/**"] },
  { rules: { "no-undef": "error", "no-unused-vars": ["error", { args: "none" }], "no-constant-binary-expression": "error" } },
  {
    files: ["business/**/*.mjs", "test/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { console: "readonly", process: "readonly", URL: "readonly", Buffer: "readonly" } }
  },
  { files: ["api/**/*.js", "business/**/*.js"], languageOptions: { sourceType: "commonjs", globals: { process: "readonly", console: "readonly", Buffer: "readonly", require: "readonly", module: "readonly" } } },
  { files: ["app.js"], languageOptions: { sourceType: "module", globals: {
    console: "readonly", document: "readonly", window: "readonly", localStorage: "readonly", crypto: "readonly",
    Blob: "readonly", URL: "readonly", Option: "readonly", confirm: "readonly", CSS: "readonly",
    requestAnimationFrame: "readonly", scrollTo: "readonly", setTimeout: "readonly"
  } } }
];
