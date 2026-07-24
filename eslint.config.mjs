import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * Flat config (ESLint 9 + Next 16). `next lint` foi removido no Next 16;
 * o script `npm run lint` chama o ESLint diretamente.
 */
const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "coverage/**",
      "next-env.d.ts",
      "prisma/migrations/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // `any` derrota o propósito do modo estrito (briefing §37).
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Erros nunca podem ser silenciados.
      "no-empty": ["error", { allowEmptyCatch: false }],
    },
  },
];

export default config;
