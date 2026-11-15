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
  assert.deepEqual(PRIMARY_MODEL_PROVIDERS, ["simulation", "openrouter-free", "groq-free", "gemini-openai"]);
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
});
