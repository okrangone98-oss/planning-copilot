const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function normalizeLoopbackBaseUrl(value) {
  try {
    const url = new URL(value);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return null;
    if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isLoopbackOllamaUrl(value) {
  return normalizeLoopbackBaseUrl(value) !== null;
}

export function isRemoteOllamaModel(value) {
  if (!value || typeof value !== "object") return false;
  const name = typeof value.name === "string" ? value.name : "";
  return Boolean(value.remote_host || value.remote_model) || /(?:^|[:/-])cloud(?:$|[:/-])/i.test(name);
}

export function sanitizeModelSettings(saved, defaults) {
  const value = saved && typeof saved === "object" ? saved : {};
  return {
    provider: value.provider === "ollama" ? "ollama" : "simulation",
    ollamaBaseUrl: normalizeLoopbackBaseUrl(value.ollamaBaseUrl) || defaults.ollamaBaseUrl,
    ollamaModel: typeof value.ollamaModel === "string" && value.ollamaModel.trim()
      ? value.ollamaModel.trim()
      : defaults.ollamaModel
  };
}
