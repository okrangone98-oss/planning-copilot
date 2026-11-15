// 기관 표준 사업계획서 연습 양식(public/practice/plan-practice-form.hwpx)을 다시 만든다.
//
//   node scripts/make-practice-template.mjs
//
// kordoc 이 필요하다(Node.js 20 이상, 처음 한 번은 npx 가 내려받는다).
// 양식 원문은 src/lib/practiceTemplate.mjs 의 PRACTICE_TEMPLATE_TEXT 한 곳에만 둔다 — 앱 폴백과 같은 글이다.
// 만든 뒤에는 `npx -y kordoc@4.24.80 fill public/practice/plan-practice-form.hwpx --dry-run` 으로
// 칸 이름이 그대로인지 확인한다(앱의 kordoc 채우기 데이터가 이 이름으로 만들어진다).

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KORDOC_SPEC_VERSION } from "../src/lib/kordocFormSpec.mjs";
import { PRACTICE_TEMPLATE_FILE, PRACTICE_TEMPLATE_TEXT } from "../src/lib/practiceTemplate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = resolve(root, "public/practice");
const outFile = resolve(outDir, PRACTICE_TEMPLATE_FILE);
const mdFile = resolve(outDir, "plan-practice-form.md");

mkdirSync(outDir, { recursive: true });
writeFileSync(mdFile, PRACTICE_TEMPLATE_TEXT, "utf-8");

const args = ["-y", `kordoc@${KORDOC_SPEC_VERSION}`, "generate", mdFile, "-o", outFile, "--preset", "계획서", "--silent"];
console.log(`[practice] npx ${args.join(" ")}`);
// 양식 원문 md 도 함께 남긴다 — 양식이 어떻게 생겼는지 글자로 확인할 수 있다.
execFileSync("npx", args, { stdio: "inherit" });
console.log(`[practice] ${outFile} 를 만들었습니다. (원문 ${mdFile})`);
