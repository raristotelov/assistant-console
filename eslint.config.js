const js = require("@eslint/js");
const globals = require("globals");
const prettier = require("eslint-config-prettier");

module.exports = [
  {
    ignores: ["dist/**", "node_modules/**", "tools/**", "src/__pycache__/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["src/renderer.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        Terminal: "readonly",
        FitAddon: "readonly",
        formatTokens: "readonly",
        sessionName: "readonly",
        sessionMonogram: "readonly",
        sessionStatus: "readonly",
        micState: "readonly",
        speakerState: "readonly",
      },
    },
  },
  prettier,
];
