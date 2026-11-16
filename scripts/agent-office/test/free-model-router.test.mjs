import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChatRequest,
  describeHttpFailure,
  normalizeModelError,
  parseChatCompletion,
  requestFreeModel,
  resolveEndpoint
} from "../../../src/lib/freeModelRouter.mjs";
import {
  isProxyBaseUrl,
  providerConfig,
  redactSecrets,
  remoteModelField,
  sanitizeModelSettings,
  validateApiKey
} from "../../../src/lib/modelSafety.mjs";

const KEYS = {
  amd: `tl-${"a1b2c3d4e5".repeat(5)}`,
  openrouter: `sk-or-v1-${"f0e1d2c3b4a5".repeat(3)}`,
  groq: `gsk_${"a1b2c3d4e5".repeat(4)}`,
  gemini: `AIza${"SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4".slice(0, 30)}`,
  geminiAq: "AQ.Ab8RN6DummyKeyForTest1234567890",
  github: `ghp_${"a1b2c3d4e5".repeat(4)}`,
  exaone: "exaone-test-key-1234"
};

test("제공자 주소는 고정값을 쓰고, 로컬 프록시만 직접 입력한다", () => {
  assert.equal(resolveEndpoint("openrouter-free"), "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(resolveEndpoint("groq-free"), "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(resolveEndpoint("gemini-openai"), "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(resolveEndpoint("exaone"), "https://api.exaone.ai/v1/chat/completions");
  assert.equal(resolveEndpoint("github-models"), "https://models.github.ai/inference/chat/completions");
  assert.equal(resolveEndpoint("amd-tokenlab"), "https://api.tokenlab.amd.com/v1/chat/completions");
  assert.equal(resolveEndpoint("custom-openai", "http://127.0.0.1:8080/v1"), "http://127.0.0.1:8080/v1/chat/completions");
  assert.equal(resolveEndpoint("custom-openai", "http://192.168.0.9:11434/v1"), "http://192.168.0.9:11434/v1/chat/completions");
  assert.equal(resolveEndpoint("custom-openai", "http://127.0.0.1:8080/v1/chat/completions"), "http://127.0.0.1:8080/v1/chat/completions");
  assert.throws(() => resolveEndpoint("custom-openai", "https://evil.example.com/v1"), /사설망|127\.0\.0\.1/);
  assert.throws(() => resolveEndpoint("custom-openai", ""), /프록시 주소/);
  assert.throws(() => resolveEndpoint("ollama"), /제공자/);
});

test("브라우저 호출 가능 여부를 제공자별로 표시한다", () => {
  assert.equal(providerConfig("openrouter-free").cors, "allowed");
  assert.equal(providerConfig("groq-free").cors, "allowed");
  assert.equal(providerConfig("gemini-openai").cors, "allowed");
  assert.equal(providerConfig("exaone").cors, "blocked");
  assert.equal(providerConfig("github-models").cors, "blocked");
  assert.equal(providerConfig("amd-tokenlab").cors, "blocked");
  assert.equal(providerConfig("custom-openai").cors, "custom");
  assert.match(providerConfig("amd-tokenlab").corsNote, /2026-11-15/);
  assert.match(providerConfig("groq-free").corsNote, /직접 호출 가능/);
});

test("키 형식은 제공자별로 확인하고 프록시 키는 비워 둘 수 있다", () => {
  assert.equal(validateApiKey("amd-tokenlab", KEYS.amd).ok, true);
  assert.equal(validateApiKey("amd-tokenlab", KEYS.openrouter).ok, false);
  assert.equal(validateApiKey("openrouter-free", KEYS.openrouter).ok, true);
  assert.equal(validateApiKey("groq-free", KEYS.groq).ok, true);
  assert.equal(validateApiKey("groq-free", KEYS.openrouter).ok, false);
  assert.equal(validateApiKey("gemini-openai", KEYS.gemini).ok, true);
  assert.equal(validateApiKey("github-models", KEYS.github).ok, true);
  assert.equal(validateApiKey("exaone", KEYS.exaone).ok, true);
  assert.equal(validateApiKey("exaone", "").ok, false);
  assert.equal(validateApiKey("custom-openai", "").ok, true);
  assert.equal(validateApiKey("simulation", KEYS.amd).ok, false);
});

test("Gemini 키는 구형식(AIza)·신형식(AQ.)을 모두 받고 잘못된 모양은 거부한다", () => {
  // 2026년 Google AI Studio는 `AQ.` 새 형식을 발급한다. 둘 다 통과해야 한다.
  assert.equal(validateApiKey("gemini-openai", KEYS.gemini).ok, true);
  assert.equal(validateApiKey("gemini-openai", KEYS.geminiAq).ok, true);
  assert.equal(validateApiKey("gemini-openai", `  ${KEYS.geminiAq}  `).ok, true);
  // 형식이 어긋나면 거부하고, 안내 문구에 두 형식을 함께 알려 준다.
  ["AQ", "AQ.", "AQ.short", "aq.Ab8RN6DummyKeyForTest1234567890", "AIzaAIzaAIza", "Ab8RN6DummyKeyForTest1234567890", ""].forEach((bad) => {
    const result = validateApiKey("gemini-openai", bad);
    assert.equal(result.ok, false, bad);
    assert.match(result.message, /AIza 또는 AQ\./, bad);
  });
  assert.match(providerConfig("gemini-openai").keyLabel, /AIza 또는 AQ\./);
  // AQ. 키도 Gemini 제공자에만 쓸 수 있고 다른 제공자에서는 거부된다.
  assert.equal(validateApiKey("groq-free", KEYS.geminiAq).ok, false);
  assert.equal(buildChatRequest({ provider: "gemini-openai", model: "gemini-2.5-flash", prompt: "요약", apiKey: KEYS.geminiAq }).init.headers.Authorization, `Bearer ${KEYS.geminiAq}`);
  assert.throws(() => buildChatRequest({ provider: "gemini-openai", model: "gemini-2.5-flash", prompt: "요약", apiKey: "AQ.tooShort" }), /키 형식/);
});

test("요청은 제공자별 고정 주소로 가고 키는 헤더에만 둔다", () => {
  const cases = [
    ["openrouter-free", "openrouter/free", KEYS.openrouter, "https://openrouter.ai/api/v1/chat/completions"],
    ["groq-free", "openai/gpt-oss-120b", KEYS.groq, "https://api.groq.com/openai/v1/chat/completions"],
    ["gemini-openai", "gemini-2.5-flash", KEYS.gemini, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"],
    ["exaone", "k-exaone_v2.5", KEYS.exaone, "https://api.exaone.ai/v1/chat/completions"],
    ["github-models", "openai/gpt-4.1-mini", KEYS.github, "https://models.github.ai/inference/chat/completions"],
    ["amd-tokenlab", "Gemma-4-31B-IT", KEYS.amd, "https://api.tokenlab.amd.com/v1/chat/completions"]
  ];
  cases.forEach(([provider, model, key, url]) => {
    const request = buildChatRequest({ provider, model, prompt: "공고문 요약", apiKey: key });
    assert.equal(request.url, url, provider);
    assert.equal(request.init.headers.Authorization, `Bearer ${key}`);
    assert.equal(String(request.init.body).includes(key), false, `${provider} 본문에 키가 들어가면 안 된다`);
    assert.equal(JSON.parse(request.init.body).model, model);
  });

  const proxy = buildChatRequest({ provider: "custom-openai", model: "k-exaone_v2.5", prompt: "요약", apiKey: KEYS.exaone, baseUrl: "http://127.0.0.1:8000/v1" });
  assert.equal(proxy.url, "http://127.0.0.1:8000/v1/chat/completions");

  const noKey = buildChatRequest({ provider: "custom-openai", model: "local", prompt: "요약", baseUrl: "http://127.0.0.1:8000/v1" });
  assert.equal("Authorization" in noKey.init.headers, false);
});

test("키가 형식에 맞지 않으면 요청을 만들지 않는다", () => {
  assert.throws(() => buildChatRequest({ provider: "amd-tokenlab", model: "Gemma-4-31B-IT", prompt: "x", apiKey: "wrong" }), /키 형식/);
  assert.throws(() => buildChatRequest({ provider: "custom-openai", model: "", prompt: "x", baseUrl: "http://127.0.0.1:8000" }), /모델/);
  assert.throws(() => buildChatRequest({ provider: "simulation", prompt: "x", apiKey: KEYS.amd }), /제공자/);
});

test("응답 본문에서 텍스트만 꺼낸다", () => {
  assert.equal(parseChatCompletion({ choices: [{ message: { content: "  결과  " } }] }), "결과");
  assert.equal(parseChatCompletion({ choices: [{ message: { content: [{ type: "text", text: "가" }, { type: "text", text: "나" }] } }] }), "가\n나");
  assert.equal(parseChatCompletion({ choices: [{ text: "레거시 응답" }] }), "레거시 응답");
  assert.throws(() => parseChatCompletion({ choices: [] }), /비어 있습니다/);
});

test("HTTP 실패는 원인별로 다르게 설명하고 키를 남기지 않는다", () => {
  assert.match(describeHttpFailure(401, `{"error":"bad key ${KEYS.groq}"}`), /키가 거부/);
  assert.equal(describeHttpFailure(401, `bad key ${KEYS.groq}`).includes(KEYS.groq), false);
  assert.match(describeHttpFailure(429, ""), /호출 한도/);
  assert.match(describeHttpFailure(404, ""), /모델 이름/);
  assert.match(describeHttpFailure(503, ""), /서버 오류/);
  assert.match(describeHttpFailure(418, "teapot"), /418/);
  const redacted = redactSecrets(`Bearer ${KEYS.openrouter} ${KEYS.amd} ${KEYS.groq} ${KEYS.gemini} ${KEYS.geminiAq} ${KEYS.github}`);
  Object.values(KEYS).slice(0, 6).forEach((key) => assert.equal(redacted.includes(key), false, key.slice(0, 6)));
  // 신형식 AQ. 키도 응답 본문·오류 메시지에서 가려진다.
  assert.equal(redactSecrets(`{"error":"API key not valid: ${KEYS.geminiAq}"}`).includes("Ab8RN6Dummy"), false);
  assert.match(redactSecrets(`키 ${KEYS.geminiAq}`), /AQ\.\*\*\*/);
});

test("CORS·네트워크 차단은 키 문제와 구분해 안내한다", () => {
  const message = normalizeModelError(new TypeError("Failed to fetch"));
  assert.match(message, /CORS/);
  assert.match(message, /질문 복사|프록시/);
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.match(normalizeModelError(abort), /시간이 초과/);
  assert.equal(normalizeModelError(new Error("기타 오류")), "기타 오류");
});

test("fetch를 주입해 성공·한도·차단 경로를 확인한다", async () => {
  const base = { provider: "groq-free", model: "openai/gpt-oss-120b", prompt: "요약", apiKey: KEYS.groq };
  let captured = null;
  const success = await requestFreeModel({
    ...base,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "정리된 답" } }] }) };
    }
  });
  assert.equal(success.ok, true);
  assert.equal(success.output, "정리된 답");
  assert.equal(captured.url, "https://api.groq.com/openai/v1/chat/completions");

  const limited = await requestFreeModel({ ...base, fetchImpl: async () => ({ ok: false, status: 429, text: async () => "rate limited" }) });
  assert.equal(limited.ok, false);
  assert.match(limited.error, /호출 한도/);

  const blocked = await requestFreeModel({ ...base, fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /CORS/);
});

test("공용 무료 AI 중계는 키 없이 호출하고, 상위 경로를 본문에 넣는다", async () => {
  const { buildChatRequest, parseChatCompletion, requestFreeModel, resolveEndpoint } = await import("../../../src/lib/freeModelRouter.mjs");

  assert.equal(
    resolveEndpoint("team-free-proxy"),
    "https://planning-copilot-ai-proxy.okrangone98.workers.dev/v1/chat/completions"
  );

  // 키도 모델도 없이 요청이 만들어진다 — 중계가 경로별 기본 모델을 고른다.
  const auto = buildChatRequest({ provider: "team-free-proxy", prompt: "요약", route: "auto" });
  const autoBody = JSON.parse(String(auto.init.body));
  assert.equal(auto.url, "https://planning-copilot-ai-proxy.okrangone98.workers.dev/v1/chat/completions");
  assert.equal(autoBody.provider, "auto");
  assert.equal("model" in autoBody, false, "모델을 비우면 본문에 모델 이름을 보내지 않는다");
  assert.equal("Authorization" in auto.init.headers, false, "중계에는 개인 키를 보내지 않는다");
  assert.equal(autoBody.stream, false);
  assert.equal(autoBody.messages.length, 2);

  const gemini = buildChatRequest({ provider: "team-free-proxy", prompt: "요약", route: "gemini", model: "gemini-2.5-flash" });
  const geminiBody = JSON.parse(String(gemini.init.body));
  assert.equal(geminiBody.provider, "gemini");
  assert.equal(geminiBody.model, "gemini-2.5-flash");

  // 목록에 없는 경로는 auto 로 되돌린다(중계에 임의 문자열을 넘기지 않는다).
  assert.equal(JSON.parse(String(buildChatRequest({ provider: "team-free-proxy", prompt: "요약", route: "openai-paid" }).init.body)).provider, "auto");

  // 중계가 알려 준 실제 경로(X-Proxy-Provider)를 돌려준다.
  const response = await requestFreeModel({
    provider: "team-free-proxy",
    prompt: "성과 3개",
    route: "auto",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => (name.toLowerCase() === "x-proxy-provider" ? "gemini" : null) },
      json: async () => ({ choices: [{ message: { content: "1. 소득 증대" } }] })
    })
  });
  assert.equal(response.ok, true);
  assert.equal(response.output, "1. 소득 증대");
  assert.equal(response.upstream, "gemini");

  // 헤더를 못 읽는 환경에서도 응답은 살린다.
  const noHeader = await requestFreeModel({
    provider: "team-free-proxy",
    prompt: "성과 3개",
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "답" } }] }) })
  });
  assert.equal(noHeader.ok, true);
  assert.equal(noHeader.upstream, "");

  // 무료 추론 모델이 본문 없이 생각만 하다 끝난 경우를 ‘빈 응답’과 구분해 알려 준다.
  assert.throws(() => parseChatCompletion({ choices: [{ message: { content: null, reasoning: "생각만 함" }, finish_reason: "length" }] }), /생각만/);
  assert.throws(() => parseChatCompletion({ choices: [] }), /비어 있습니다/);
});

test("저장 설정에는 어떤 제공자의 키도 남지 않는다", () => {
  const defaults = {
    provider: "simulation",
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaModel: "llama3.1",
    proxyRoute: "auto",
    proxyModel: "",
    openrouterModel: "openrouter/free",
    groqModel: "openai/gpt-oss-120b",
    geminiModel: "gemini-2.5-flash",
    exaoneModel: "k-exaone_v2.5",
    githubModel: "openai/gpt-4.1-mini",
    amdModel: "Gemma-4-31B-IT",
    customModel: "",
    customBaseUrl: ""
  };
  const saved = {
    provider: "gemini-openai",
    ollamaBaseUrl: "https://example.com",
    ollamaModel: " qwen2.5 ",
    geminiModel: "gemini-2.5-flash-lite",
    customBaseUrl: "http://127.0.0.1:8080/v1",
    amdApiKey: KEYS.amd,
    apiKey: KEYS.groq,
    token: KEYS.github,
    geminiApiKey: KEYS.gemini
  };
  const settings = sanitizeModelSettings(saved, defaults);
  assert.deepEqual(settings, {
    provider: "gemini-openai",
    ollamaBaseUrl: defaults.ollamaBaseUrl,
    ollamaModel: "qwen2.5",
    customBaseUrl: "http://127.0.0.1:8080/v1",
    proxyRoute: "auto",
    proxyModel: "",
    openrouterModel: defaults.openrouterModel,
    groqModel: defaults.groqModel,
    geminiModel: "gemini-2.5-flash-lite",
    exaoneModel: defaults.exaoneModel,
    githubModel: defaults.githubModel,
    amdModel: defaults.amdModel,
    customModel: ""
  });
  const serialized = JSON.stringify(settings);
  [KEYS.amd, KEYS.groq, KEYS.github, KEYS.gemini].forEach((key) => assert.equal(serialized.includes(key), false));

  // 공용 인터넷 주소는 프록시 설정으로도 저장하지 않는다.
  assert.equal(sanitizeModelSettings({ customBaseUrl: "https://proxy.example.com/v1" }, defaults).customBaseUrl, "");
  assert.equal(isProxyBaseUrl("http://10.1.2.3:9000/v1"), true);
  assert.equal(isProxyBaseUrl("http://172.20.0.5:9000"), true);
  assert.equal(isProxyBaseUrl("http://8.8.8.8:9000"), false);
  assert.equal(isProxyBaseUrl("ftp://127.0.0.1"), false);
});

test("제공자별 모델 필드가 따로 저장된다", () => {
  assert.equal(remoteModelField("groq-free"), "groqModel");
  assert.equal(remoteModelField("gemini-openai"), "geminiModel");
  assert.equal(remoteModelField("amd-tokenlab"), "amdModel");
  assert.equal(remoteModelField("custom-openai"), "customModel");
  assert.equal(remoteModelField("ollama"), null);
});
