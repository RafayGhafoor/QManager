import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // One resolver for "is motion reduced": the in-app preference outranks the OS query.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["motion/react", "framer-motion"].map((name) => ({
            name,
            importNames: ["useReducedMotion"],
            message:
              'It ignores the in-app Animations preference. Use useMotionReduced from "@/components/motion-preference".',
          })),
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='matchMedia'] > Literal[value=/prefers-reduced-motion/], CallExpression[callee.name='matchMedia'] > Literal[value=/prefers-reduced-motion/]",
          message:
            'It ignores the in-app Animations preference. Use isMotionReduced from "@/lib/motion-preference" (or the useMotionReduced hook).',
        },
      ],
    },
  },
  {
    // The resolver itself is the one place allowed to read the OS query.
    files: ["lib/motion-preference.ts", "components/motion-preference.tsx"],
    rules: { "no-restricted-syntax": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "tools/**",
  ]),
  {
    rules: {
      // QManager is a static export (`output: "export"`) served by the modem's
      // own web server over LAN. `next/image` requires the Next.js image
      // optimization server, which does not exist in this deployment model, and
      // with `images.unoptimized` it degrades to a plain <img> anyway. Every
      // image we serve is a small local asset from /public — there is no remote
      // provider, bandwidth cost, or LCP penalty for the rule to guard against.
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;
