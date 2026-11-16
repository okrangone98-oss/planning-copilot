// 실제 기관 양식 전수 검증 스크립트 — 양식 파일은 저장소에 넣지 않고, 이 스크립트만 저장소에 둔다.
//
//   node scripts/verify-real-forms.mjs ../../work/real-forms            # 표로 출력
//   node scripts/verify-real-forms.mjs ../../work/real-forms --json     # JSON
//   node scripts/verify-real-forms.mjs ../../work/real-forms --kordoc   # kordoc validate 까지
//
// 하는 일(앱과 같은 코드 경로):
//   ① 구조·칸 인식(readHwpxBlocks → parseSampleTemplate → extractFormFields)
//   ② 자유 텍스트 규칙 배치(mapFreeTextToFields) — AI 경로는 쓰지 않는다(개인정보 문서)
//   ③ 브라우저 패치(patchHwpxBytes) + 다시 읽어 값 일치 확인
//   ④ 표·문단 수, header.xml, mimetype(STORE·첫 엔트리) 무결성
//   ⑤ 개인정보 탐지 건수(값은 출력하지 않는다)
// 출력에는 개인정보 값이 들어가지 않는다 — 칸 이름·건수·정오만 남긴다.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(`${ROOT}/package.json`);
const JSZip = require("jszip");
const { readHwpxBlocks, parseSampleTemplate } = await import(`${ROOT}/src/lib/sampleTemplateParser.mjs`);
const { extractFormFields, isLegalDocumentSchema } = await import(`${ROOT}/src/lib/kordocFormSpec.mjs`);
const { patchHwpxBytes } = await import(`${ROOT}/src/lib/browserHwpxFiller.mjs`);
const { mapFreeTextToFields } = await import(`${ROOT}/src/lib/smartTextMapper.mjs`);
const { scanPii } = await import(`${ROOT}/src/lib/piiGuard.mjs`);

const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith("--")) || process.env.REAL_FORMS_DIR || "";
const asJson = args.includes("--json");
const withKordoc = args.includes("--kordoc");

if (!target) {
  console.error("양식 폴더를 지정해 주세요. 예: node scripts/verify-real-forms.mjs ../../work/real-forms");
  process.exit(1);
}
const dir = path.resolve(process.cwd(), target);
if (!fs.existsSync(dir)) {
  console.error(`폴더를 찾지 못했습니다: ${dir}`);
  process.exit(1);
}

const SAMPLE_BY_TYPE = {
  text: "검증용 값",
  date: "2026-03-02",
  amount: "1,200,000원",
  phone: "010-1234-5678",
  email: "test@example.com",
  idnum: "900101-1234567",
  checkbox: "☑"
};
const FREE_TEXT = [
  "사업명: 검증용 생활문화 지원사업",
  "수행기관: 검증용 농촌활성화지원센터",
  "사업기간: 2026년 3월 ~ 11월",
  "총사업비: 4,800만원",
  "지역에는 빈집이 늘고 청년이 떠나고 있습니다."
].join("\n");

function kordocValidate(filePath) {
  const run = spawnSync("npx", ["-y", "kordoc@4.24.80", "validate", filePath, "--json"], {
    cwd: ROOT,
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}` },
    timeout: 120000,
    encoding: "utf8"
  });
  const stdout = String(run.stdout || "").trim();
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false, issues: -1 };
  try {
    const parsed = JSON.parse(stdout.slice(start, end + 1));
    return { ok: Boolean(parsed.ok), issues: (parsed.issues || []).length, entries: parsed.entryCount };
  } catch {
    return { ok: false, issues: -1 };
  }
}

const countTags = (xml, tag) => (xml.match(new RegExp(`<hp:${tag}[ >]`, "g")) || []).length;
const cellTexts = (xml) => Array.from(String(xml).matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)).map((m) => m[1]);

const files = fs.readdirSync(dir).filter((name) => /\.hwpx$/i.test(name)).sort();
const rows = [];
for (const file of files) {
  const filePath = path.join(dir, file);
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  const zip = await JSZip.loadAsync(bytes);
  const sectionName = Object.keys(zip.files).find((name) => /^Contents\/section0\.xml$/.test(name));
  const sourceSection = sectionName ? await zip.file(sectionName).async("text") : "";
  const headerSource = await zip.file("Contents/header.xml").async("text");
  const schema = parseSampleTemplate({ blocks: await readHwpxBlocks(zip), fileName: file, format: "hwpx" });
  const fields = extractFormFields(schema);
  const blanks = fields.filter((field) => field.empty);

  const values = {};
  for (const field of blanks.slice(0, 40)) {
    const key = field.fillKey || field.label;
    const sample = SAMPLE_BY_TYPE[field.type] || SAMPLE_BY_TYPE.text;
    if (values[key] === undefined) values[key] = sample;
    else if (Array.isArray(values[key])) values[key].push(sample);
    else values[key] = [values[key], sample];
  }

  const mapped = fields.length ? mapFreeTextToFields({ fields, text: FREE_TEXT }) : { rows: [], leftovers: [] };
  const pii = scanPii(sourceSection.replace(/<[^>]+>/g, " "));

  const checks = {};
  if (Object.keys(values).length) {
    const result = await patchHwpxBytes({ bytes, values });
    const outZip = await JSZip.loadAsync(result.bytes);
    const outSection = await outZip.file(sectionName).async("text");
    const rereadFields = extractFormFields(parseSampleTemplate({
      blocks: await readHwpxBlocks(outZip),
      fileName: file,
      format: "hwpx"
    }));
    const rereadText = rereadFields.map((field) => field.value).join("\u0001");
    const missing = result.filled.filter((entry) => {
      const value = Array.isArray(entry.value) ? entry.value.join(" ") : String(entry.value);
      return !rereadText.includes(value);
    });
    checks.filled = result.filled.length;
    checks.skipped = result.skipped.length;
    checks.unmatched = result.unmatched.length;
    checks.rereadMissing = missing.length;
    checks.structureSame = countTags(outSection, "tc") === countTags(sourceSection, "tc")
      && countTags(outSection, "tr") === countTags(sourceSection, "tr")
      && countTags(outSection, "tbl") === countTags(sourceSection, "tbl");
    checks.headerSame = (await outZip.file("Contents/header.xml").async("text")) === headerSource;
    checks.mimetypeFirst = Object.keys(outZip.files)[0] === "mimetype";
    checks.mimetypeStored = Buffer.from(result.bytes).readUInt16LE(8) === 0;
    checks.textRunsAdded = cellTexts(outSection).length - cellTexts(sourceSection).length;
  }

  rows.push({
    file,
    bytes: bytes.length,
    sections: Object.keys(zip.files).filter((name) => /^Contents\/section\d+\.xml$/i.test(name)).length,
    tables: schema.counts.tables,
    fields: fields.length,
    blanks: blanks.length,
    legal: isLegalDocumentSchema(schema),
    mapped: mapped.rows.length,
    mappedLeftovers: mapped.leftovers.length,
    piiTotal: pii.total || 0,
    piiKinds: (pii.types || []).map((type) => `${type.badge} ${type.count}`).join(", "),
    ...checks,
    ...(withKordoc ? { kordoc: kordocValidate(filePath) } : {})
  });
}

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const yes = (value) => (value === undefined ? "—" : value ? "정상" : "확인 필요");
  const header = ["양식", "표", "인식 칸", "빈칸", "규칙 배치", "채운 칸", "재읽기 누락", "표 구조", "header", "mimetype", "PII", ...(withKordoc ? ["kordoc"] : [])];
  console.log(`| ${header.join(" | ")} |`);
  console.log(`| ${header.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    const line = [
      row.file,
      row.tables,
      row.fields,
      row.blanks,
      row.mapped,
      row.filled === undefined ? "—" : row.filled,
      row.rereadMissing === undefined ? "—" : `${row.rereadMissing}건`,
      yes(row.structureSame),
      yes(row.headerSame),
      yes(row.mimetypeFirst === undefined ? undefined : row.mimetypeFirst && row.mimetypeStored),
      row.piiTotal ? `${row.piiTotal}건` : "없음",
      ...(withKordoc ? [row.kordoc ? (row.kordoc.ok ? "통과" : `문제 ${row.kordoc.issues}건`) : "—"] : [])
    ];
    console.log(`| ${line.join(" | ")} |`);
  }
  const legal = rows.filter((row) => row.legal).map((row) => row.file);
  if (legal.length) console.log(`\n법령·조례 본문(칸 0개가 정상): ${legal.join(", ")}`);
  const broken = rows.filter((row) => row.structureSame === false || row.headerSame === false || row.mimetypeFirst === false);
  if (broken.length) console.log(`\n무결성 확인 필요: ${broken.map((row) => row.file).join(", ")}`);
}
