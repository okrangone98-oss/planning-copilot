import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PII_OPTIONS,
  describePiiScan,
  hasMaskedTokens,
  isForeignerId,
  isValidBusinessNumber,
  isValidCardNumber,
  isValidRrn,
  maskPii,
  maskPreview,
  maskRecord,
  normalizeOptions,
  scanPii
} from "../../../src/lib/piiGuard.mjs";

const SAMPLE = [
  "안녕하세요. 담당자: 홍길동 입니다.",
  "휴대폰 010-1234-5678, 사무실 033-671-1234, 메일 hong@example.com 입니다.",
  "주민등록번호 900101-1234568, 카드 4111-1111-1111-1111.",
  "입금 계좌는 국민은행 110-123-456789 입니다.",
  "주소는 강원특별자치도 양양군 현남면 남애리 123-4, 도로명은 서울 강남구 테헤란로 152 입니다."
].join("\n");

test("주민등록번호·카드·사업자번호 검사번호를 확인한다", () => {
  assert.equal(isValidRrn("900101-1234568"), true);
  assert.equal(isValidRrn("9001011234568"), true);
  assert.equal(isValidRrn("900101-1234567"), false);
  assert.equal(isForeignerId("900101-5234569"), true);
  assert.equal(isForeignerId("900101-1234568"), false);
  assert.equal(isValidCardNumber("4111-1111-1111-1111"), true);
  assert.equal(isValidCardNumber("4111-1111-1111-1112"), false);
  assert.equal(isValidBusinessNumber("123-45-67896"), true);
  assert.equal(isValidBusinessNumber("123-45-67890"), false);
});

test("요구한 개인정보 종류를 모두 찾는다", () => {
  const scan = scanPii(SAMPLE);
  const counts = scan.counts;
  assert.equal(counts.name, 1);
  assert.equal(counts.phone, 2);
  assert.equal(counts.email, 1);
  assert.equal(counts.rrn, 1);
  assert.equal(counts.card, 1);
  assert.equal(counts.account, 1);
  assert.equal(counts.address, 2);
  assert.equal(scan.total, 9);
  assert.match(scan.badgeText, /연락처 2/);
  assert.match(scan.badgeText, /이메일 1/);
});

test("마스킹은 [연락처_1] 형태로 바꾸고 원문 번호를 남기지 않는다", () => {
  const masked = maskPii(SAMPLE);
  assert.match(masked.text, /\[성명_1\]/);
  assert.match(masked.text, /\[연락처_1\]/);
  assert.match(masked.text, /\[연락처_2\]/);
  assert.match(masked.text, /\[이메일_1\]/);
  assert.match(masked.text, /\[주민번호_1\]/);
  assert.match(masked.text, /\[카드_1\]/);
  assert.match(masked.text, /\[계좌_1\]/);
  assert.match(masked.text, /\[주소_1\]/);
  assert.doesNotMatch(masked.text, /010-1234-5678/);
  assert.doesNotMatch(masked.text, /900101-1234568/);
  assert.doesNotMatch(masked.text, /hong@example\.com/);
  assert.doesNotMatch(masked.text, /110-123-456789/);
  // 주소는 두 곳(지번·도로명)이라 자리표시자도 둘이다.
  assert.equal(masked.placeholders.length, 9);
});

test("같은 값은 같은 자리표시자를 쓰고, 두 번 가려도 더 바뀌지 않는다", () => {
  const text = "연락처 010-1234-5678 또는 01012345678 로 연락 주세요.";
  const masked = maskPii(text);
  assert.equal(masked.total, 2);
  assert.equal(masked.replaced, 1);
  assert.equal(masked.text, "연락처 [연락처_1] 또는 [연락처_1] 로 연락 주세요.");
  assert.equal(maskPii(masked.text).total, 0);
  assert.equal(hasMaskedTokens(masked.text), true);
  assert.equal(hasMaskedTokens(text), false);
});

test("날짜·금액·사업비 같은 숫자는 개인정보로 잡지 않는다", () => {
  const text = "2026-11-15 ~ 2026-12-31, 신청기간 2026. 3. 2.~3. 20., 사업비 50,000,000원, 접수번호 2026-001-123456, 3~5명";
  assert.equal(scanPii(text).total, 0);
  assert.equal(maskPii(text).text, text);
});

test("공고문에서 흔한 문장은 연락처와 담당자만 가린다", () => {
  const text = "2026년 양양군 청년정책 사업 공고문입니다. 문의는 033-670-1234, 담당자: 이영희 주무관입니다. 사업비는 50,000,000원 규모입니다.";
  const masked = maskPii(text);
  assert.equal(masked.total, 2);
  assert.match(masked.text, /\[연락처_1\]/);
  assert.match(masked.text, /\[성명_1\] 주무관/);
  assert.match(masked.text, /50,000,000원/);
  assert.match(masked.text, /2026년/);
});

test("종류별 옵션을 끄면 그 종류는 가리지 않는다", () => {
  const text = "연락처 010-1234-5678, 메일 hong@example.com";
  const masked = maskPii(text, { phone: false });
  assert.equal(masked.counts.phone, undefined);
  assert.equal(masked.counts.email, 1);
  assert.match(masked.text, /010-1234-5678/);
  assert.match(masked.text, /\[이메일_1\]/);

  const listOnly = maskPii(text, ["email"]);
  assert.equal(listOnly.counts.phone, undefined);
  assert.equal(listOnly.counts.email, 1);
});

test("사업자등록번호는 선택 옵션일 때만 가린다", () => {
  assert.equal(DEFAULT_PII_OPTIONS.business, false);
  const text = "사업자등록번호 123-45-67896";
  assert.equal(maskPii(text).total, 0);
  assert.equal(maskPii(text, { business: true }).text, "사업자등록번호 [사업자번호_1]");
  assert.equal(normalizeOptions({ business: true }).business, true);
});

test("외국인등록번호는 이름을 따로 표시한다", () => {
  const scan = scanPii("외국인등록번호 900101-5234569");
  assert.equal(scan.total, 1);
  assert.equal(scan.findings[0].label, "외국인등록번호");
  assert.equal(scan.findings[0].preview.startsWith("900101"), true);
});

test("연락처 표기가 달라도 같은 값으로 읽는다", () => {
  for (const value of ["010-1234-5678", "01012345678", "010 1234 5678", "+82 10-1234-5678"]) {
    assert.equal(scanPii(`연락처 ${value}`).counts.phone, 1, value);
  }
  assert.equal(scanPii("문의 02-123-4567").counts.phone, 1);
  assert.equal(scanPii("문의 070-1234-5678").counts.phone, 1);
});

test("목록 미리보기는 원문을 그대로 보여 주지 않는다", () => {
  assert.equal(maskPreview("phone", "01012345678"), "010****5678");
  assert.equal(maskPreview("email", "hong@example.com"), "ho**@example.com");
  assert.equal(maskPreview("name", "홍길동"), "홍**");
  assert.notEqual(maskPreview("rrn", "9001011234568"), "9001011234568");
});

test("이름 자리에 오는 상투어는 가리지 않는다", () => {
  assert.equal(scanPii("담당자: 없음").total, 0);
  assert.equal(scanPii("대표자: 미정").total, 0);
  assert.equal(scanPii("담당자: 홍길동").total, 1);
});

test("외부 전송 페이로드(객체) 안의 문자열도 마스킹한다", () => {
  const payload = {
    command: "010-1234-5678 로 연락",
    context: { notice: "담당자: 홍길동, hong@example.com", count: 3, empty: null },
    rows: ["033-671-1234"]
  };
  const { value, report } = maskRecord(payload);
  assert.equal(report.total, 4);
  assert.match(JSON.stringify(value), /\[연락처_1\]/);
  assert.doesNotMatch(JSON.stringify(value), /010-1234-5678/);
  assert.doesNotMatch(JSON.stringify(value), /hong@example\.com/);
  assert.equal(value.context.count, 3);
  assert.equal(value.context.empty, null);
});

test("라벨에 붙은 조사를 이름으로 읽지 않는다", () => {
  assert.equal(scanPii("당신은 한국어 사업계획서 작성 실무자입니다.").total, 0);
  assert.equal(scanPii("담당자 홍길동").total, 0);
  assert.equal(scanPii("담당자: 홍길동").counts.name, 1);
  assert.equal(scanPii("대표자 : 김철수").counts.name, 1);
});

test("이름 뒤에 붙은 전화번호를 주소로 잘못 읽지 않는다", () => {
  const masked = maskPii("담당자: 홍길동 010-1234-5678 로 연락 바랍니다.");
  assert.equal(masked.counts.address, undefined);
  assert.equal(masked.counts.phone, 1);
  assert.equal(masked.counts.name, 1);
  assert.match(masked.text, /\[연락처_1\]/);
});

test("시·군·구가 앞에 있는 지번 주소는 찾는다", () => {
  assert.equal(scanPii("양양군 현남면 남애리 123-4").counts.address, 1);
  assert.equal(scanPii("서울 강남구 역삼동 123-4").counts.address, 1);
});

test("안내 문구는 탐지 결과를 한 줄로 알려 준다", () => {
  assert.match(describePiiScan(scanPii("010-1234-5678")), /개인정보 1건 감지/);
  assert.match(describePiiScan(scanPii("평범한 문장")), /없습니다/);
});
