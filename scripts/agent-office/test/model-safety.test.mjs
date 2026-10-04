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
  const defaults = { provider: "simulation", ollamaBaseUrl: "http://127.0.0.1:11434", ollamaModel: "llama3.1" };
  const settings = sanitizeModelSettings({
    provider: "gemini",
    ollamaBaseUrl: "https://example.com",
    ollamaModel: " qwen2.5 ",
    geminiApiKey: "must-not-survive",
    githubToken: "must-not-survive"
  }, defaults);

  assert.deepEqual(settings, { provider: "simulation", ollamaBaseUrl: defaults.ollamaBaseUrl, ollamaModel: "qwen2.5" });
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
