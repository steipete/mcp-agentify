// eslint.config.js
import globals from "globals";
import tseslint from "typescript-eslint";
import prettierRecommended from "eslint-plugin-prettier/recommended";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "dist/",
      "coverage/",
      "public_debug_ui/",
      "*.md",
      "eslint.config.js",
      ".taskmasterconfig",
      ".roomodes",
      ".windsurfrules",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      ".prettierrc.json"
    ],
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        ecmaVersion: 2020,
        sourceType: "module",
      },
      globals: {
        ...globals.node,
        ...globals.es2020,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      // Base recommended rules
      ...tseslint.configs.recommended.rules,
      // Stricter type-checked rules (optional, can be too noisy initially)
      // ...tseslint.configs.recommendedTypeChecked.rules,
      
      // Customizations
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      // Add other rules or overrides here
    },
  },
  prettierRecommended, // Ensures Prettier rules are applied last
);