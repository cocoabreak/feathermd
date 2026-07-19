import js from "@eslint/js";
import ts from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import svelte from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import globals from "globals";

// Svelte 5 rune globals (.svelte.ts ファイル向け)
const svelteRunes = {
  $state: "readonly",
  $derived: "readonly",
  $effect: "readonly",
  $props: "readonly",
  $bindable: "readonly",
  $inspect: "readonly",
  $host: "readonly",
};

/** @type {import('eslint').Linter.Config[]} */
export default [
  js.configs.recommended,

  // TypeScript ファイル
  {
    files: ["**/*.ts"],
    plugins: { "@typescript-eslint": ts },
    languageOptions: {
      parser: tsParser,
      globals: { ...globals.browser },
    },
    rules: {
      ...ts.configs.recommended.rules,
    },
  },

  // Svelte runes を使う .svelte.ts モジュールファイル
  {
    files: ["**/*.svelte.ts"],
    plugins: { "@typescript-eslint": ts },
    languageOptions: {
      parser: tsParser,
      globals: { ...globals.browser, ...svelteRunes },
    },
    rules: {
      ...ts.configs.recommended.rules,
    },
  },

  // Svelte コンポーネント
  {
    files: ["**/*.svelte"],
    plugins: { svelte, "@typescript-eslint": ts },
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tsParser },
      globals: { ...globals.browser },
    },
    rules: {
      ...svelte.configs.recommended.rules,
      ...ts.configs.recommended.rules,
    },
  },

  // Node.js 環境のコンフィグファイル
  {
    files: ["vite.config.js", "*.config.js", "*.config.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    ignores: [".svelte-kit/**", "build/**", "node_modules/**", "src-tauri/**"],
  },
];
