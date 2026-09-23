import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { MockProvider, OAuthUserProvider } from "../lib/auth-provider.mjs";

class FakeOAuthClient {
  constructor(redirect) {
    this.redirect = redirect;
    this.credentials = {};
  }

  setCredentials(credentials) {
    this.credentials = credentials;
  }

  generateAuthUrl() {
    return `http://example.test/authorize?redirect_uri=${encodeURIComponent(this.redirect)}`;
  }

  async getToken() {
    return { tokens: { access_token: "test-token" } };
  }
}

test("MockProvider returns its injected client without changing it", async () => {
  const client = { kind: "mock-google-client" };
  const provider = new MockProvider(client);

  assert.equal(await provider.getAuthorizedClient(), client);
});

test("OAuthUserProvider uses the lazy client and secures an overwritten token", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "office-auth-"));
  const clientSecretPath = path.join(directory, "client-secret.json");
  const tokenPath = path.join(directory, "token.json");
  const originalConsoleError = console.error;

  await fs.writeFile(clientSecretPath, JSON.stringify({
    installed: { client_id: "test-client", client_secret: "test-secret" }
  }));
  await fs.writeFile(tokenPath, "not-json", { mode: 0o644 });
  await fs.chmod(tokenPath, 0o644);

  console.error = (message) => {
    const authorizationUrl = new URL(message.replace("Google OAuth 승인 URL: ", ""));
    const redirect = new URL(authorizationUrl.searchParams.get("redirect_uri"));
    http.get(`${redirect}?code=test-code`).on("error", () => {});
  };

  try {
    const provider = new OAuthUserProvider({
      clientSecretPath,
      tokenPath,
      createOAuthClient: async (_installed, redirect) => new FakeOAuthClient(redirect)
    });
    const client = await provider.getAuthorizedClient();

    assert.equal(client.credentials.access_token, "test-token");
    assert.equal((await fs.stat(tokenPath)).mode & 0o777, 0o600);
  } finally {
    console.error = originalConsoleError;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
