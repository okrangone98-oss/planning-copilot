import test from "node:test";
import assert from "node:assert/strict";
import { isLoopbackOllamaUrl, isRemoteOllamaModel, normalizeLoopbackBaseUrl, sanitizeModelSettings } from "../../../src/lib/modelSafety.mjs";

test("only local Ollama endpoints are accepted", () => {
  assert.equal(normalizeLoopbackBaseUrl("http://127.0.0.1:11434/"), "http://127.0.0.1:11434");
  assert.equal(isLoopbackOllamaUrl("http://localhost:11434"), true);
  assert.equal(isLoopbackOllamaUrl("https://[::1]:11434"), true);
  assert.equal(isLoopbackOllamaUrl("https://example.com"), false);
  assert.equal(isLoopbackOllamaUrl("http://localhost.example.com:11434"), false);
  assert.equal(isLoopbackOllamaUrl("file:///tmp/ollama"), false);
});

test("rejects endpoint credentials, query strings, and custom paths", () => {
  assert.equal(isLoopbackOllamaUrl("http://user:secret@127.0.0.1:11434"), false);
  assert.equal(isLoopbackOllamaUrl("http://127.0.0.1:11434?target=other"), false);
  assert.equal(isLoopbackOllamaUrl("http://127.0.0.1:11434/proxy"), false);
});

test("model settings allowlist drops legacy cloud credentials and remote endpoints", () => {
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
  const settings = sanitizeModelSettings({
    provider: "gemini",
    ollamaBaseUrl: "https://example.com",
    ollamaModel: " qwen2.5 ",
    geminiApiKey: "must-not-survive",
    githubToken: "must-not-survive"
  }, defaults);

  assert.deepEqual(settings, {
    provider: "simulation",
    ollamaBaseUrl: defaults.ollamaBaseUrl,
    ollamaModel: "qwen2.5",
    customBaseUrl: "",
    proxyRoute: "auto",
    proxyModel: "",
    openrouterModel: defaults.openrouterModel,
    groqModel: defaults.groqModel,
    geminiModel: defaults.geminiModel,
    exaoneModel: defaults.exaoneModel,
    githubModel: defaults.githubModel,
    amdModel: defaults.amdModel,
    customModel: ""
  });
  assert.equal("geminiApiKey" in settings, false);
  assert.equal("githubToken" in settings, false);
});

test("local URLs do not make cloud models or renamed remote models local", () => {
  assert.equal(isRemoteOllamaModel({ name: "gemma4:cloud" }), true);
  assert.equal(isRemoteOllamaModel({ name: "gpt-oss:120b-cloud" }), true);
  assert.equal(isRemoteOllamaModel({ name: "local-alias", remote_host: "https://ollama.com" }), true);
  assert.equal(isRemoteOllamaModel({ name: "local-alias", remote_model: "cloud-source" }), true);
  assert.equal(isRemoteOllamaModel({ name: "qwen2.5:7b" }), false);
});

test("model settings split into primary and advanced without gaps or overlaps", async () => {
  const { ADVANCED_MODEL_PROVIDERS, MODEL_PROVIDERS, PRIMARY_MODEL_PROVIDERS, providerAvailabilityNote, providerConfig } =
    await import("../../../src/lib/modelSafety.mjs");
  const grouped = [...PRIMARY_MODEL_PROVIDERS, ...ADVANCED_MODEL_PROVIDERS];
  assert.equal(new Set(grouped).size, grouped.length, "provider appears in both groups");
  assert.deepEqual([...MODEL_PROVIDERS].sort(), [...grouped].sort(), "every provider has exactly one group");

  // 기본 노출 카드는 키 없이 되거나 브라우저 직접 호출이 확인된 경로만 둔다.
  // 공용 무료 AI 중계는 키를 넣지 않고 바로 쓰는 경로라 맨 앞에 둔다.
  assert.deepEqual(PRIMARY_MODEL_PROVIDERS, ["team-free-proxy", "simulation", "openrouter-free", "groq-free", "gemini-openai"]);
  PRIMARY_MODEL_PROVIDERS.forEach((provider) => {
    const config = providerConfig(provider);
    if (config) assert.equal(config.cors, "allowed", `${provider} is not browser-callable`);
  });

  // 차단된 3종과 로컬 설치는 모두 고급 영역에 있다.
  ["exaone", "github-models", "amd-tokenlab"].forEach((provider) => {
    assert.equal(providerConfig(provider).cors, "blocked");
    assert.ok(ADVANCED_MODEL_PROVIDERS.includes(provider));
  });
  assert.ok(ADVANCED_MODEL_PROVIDERS.includes("ollama"));
  assert.ok(ADVANCED_MODEL_PROVIDERS.includes("custom-openai"));
  assert.equal(providerAvailabilityNote("simulation"), "키 없이 바로 사용");
  assert.equal(providerAvailabilityNote("ollama"), "내 컴퓨터에 설치 필요");
  assert.match(providerAvailabilityNote("team-free-proxy"), /접속 코드 필요/);
});

test("저장된 설정이 없으면 앱의 기본 경로(내 전용 중계)로 시작한다", async () => {
  const { sanitizeModelSettings } = await import("../../../src/lib/modelSafety.mjs");
  const defaults = {
    provider: "team-free-proxy",
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
  // 첫 방문(저장값 없음)에서도 기본 경로가 유지된다 — 예전에는 템플릿 모드로 고정됐다.
  assert.equal(sanitizeModelSettings({}, defaults).provider, "team-free-proxy");
  assert.equal(sanitizeModelSettings({ provider: "없는-경로" }, defaults).provider, "team-free-proxy");
  // 저장된 경로가 유효하면 그 값을 지킨다.
  assert.equal(sanitizeModelSettings({ provider: "ollama" }, defaults).provider, "ollama");
});

test("내 전용 중계는 접속 코드를 요구하고, 상위 경로만 고른다", async () => {
  const { PROXY_ROUTES, PROXY_ROUTE_LABELS, normalizeProxyRoute, providerConfig, providerNeedsExternalAck, providerRequiresKey, validateApiKey } =
    await import("../../../src/lib/modelSafety.mjs");

  const config = providerConfig("team-free-proxy");
  // 남의 API가 차감되지 않게 접속 코드 없이는 호출되지 않는다.
  assert.equal(config.requiresKey, true);
  assert.equal(config.cors, "allowed");
  // 브라우저는 이 주소 하나만 안다 — 상위 제공자 주소·키는 중계 서버 쪽에 있다.
  assert.equal(config.baseUrl, "https://planning-copilot-ai-proxy.okrangone98.workers.dev/v1");
  assert.match(config.label, /접속 코드/);
  assert.match(config.corsNote, /2026-11-16|이 탭 메모리에만/);

  assert.equal(validateApiKey("team-free-proxy", "").ok, false);
  assert.equal(validateApiKey("team-free-proxy", undefined).ok, false);
  assert.match(validateApiKey("team-free-proxy", "").message, /접속 코드/);
  // 사용자가 기억하기 쉬운 짧은 숫자 코드도 그대로 받는다(길이는 사용자가 정한다).
  assert.equal(validateApiKey("team-free-proxy", "3869").ok, true);
  assert.equal(validateApiKey("team-free-proxy", "my-code-2026").ok, true);
  assert.equal(validateApiKey("team-free-proxy", "코드 있어요").ok, false, "공백이 들어간 코드는 거부");
  assert.equal(validateApiKey("team-free-proxy", "x".repeat(65)).ok, false);
  assert.equal(providerRequiresKey("team-free-proxy"), true);
  // 자료가 밖으로 나가는 경로는 중계도 외부 전송 확인을 받는다.
  assert.equal(providerNeedsExternalAck("team-free-proxy"), true);
  assert.equal(providerRequiresKey("openrouter-free"), true);
  assert.equal(providerNeedsExternalAck("openrouter-free"), true);
  assert.equal(providerNeedsExternalAck("simulation"), false);

  assert.deepEqual(PROXY_ROUTES, ["auto", "openrouter", "gemini", "amd"]);
  assert.equal(normalizeProxyRoute("GEMINI"), "gemini");
  assert.equal(normalizeProxyRoute("없는경로"), "auto");
  assert.equal(normalizeProxyRoute(undefined), "auto");
  assert.match(PROXY_ROUTE_LABELS.auto, /자동/);
});
