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
  ]),
  {
    // 확장프로그램은 번들러 없이 <script> 태그 여러 개로 나눠 읽는다.
    // 파일 하나만 보면 "안 쓰는 함수"처럼 보이지만 실제로는 다른 파일에서 쓴다.
    files: ["extension/**/*.js"],
    rules: { "@typescript-eslint/no-unused-vars": "off" },
  },
]);

export default eslintConfig;
