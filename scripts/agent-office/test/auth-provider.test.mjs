import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { MockProvider, OAuthUserProvider, READ_ONLY_SCOPES } from "../lib/auth-provider.mjs";

class FakeOAuthClient {
  constructor(redirect) {
    this.redirect = redirect;
    this.credentials = {};
  }

  setCredentials(credentials) {
    this.credentials = credentials;
  }

  generateAuthUrl(options) {
    this.authorizationOptions = options;
    return `http://example.test/authorize?redirect_uri=${encodeURIComponent(this.redirect)}&state=${encodeURIComponent(options.state)}`;
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
    const state = authorizationUrl.searchParams.get("state");
    http.get(`${redirect}?code=test-code&state=${encodeURIComponent(state)}`).on("error", () => {});
  };

  try {
    const provider = new OAuthUserProvider({
      clientSecretPath,
      tokenPath,
      createOAuthClient: async (_installed, redirect) => new FakeOAuthClient(redirect)
    });
    const client = await provider.getAuthorizedClient();

    assert.equal(client.credentials.access_token, "test-token");
    assert.match(client.authorizationOptions.state, /^[A-Za-z0-9_-]+$/);
    assert.equal((await fs.stat(tokenPath)).mode & 0o777, 0o600);
  } finally {
    console.error = originalConsoleError;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("OAuthUserProvider rejects a loopback callback with mismatched state and closes the server", { timeout: 2_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "office-auth-"));
  const clientSecretPath = path.join(directory, "client-secret.json");
  const tokenPath = path.join(directory, "token.json");
  const originalConsoleError = console.error;
  let redirect;

  await fs.writeFile(clientSecretPath, JSON.stringify({
    installed: { client_id: "test-client", client_secret: "test-secret" }
  }));

  console.error = (message) => {
    const authorizationUrl = new URL(message.replace("Google OAuth 승인 URL: ", ""));
    redirect = new URL(authorizationUrl.searchParams.get("redirect_uri"));
    http.get(`${redirect}?code=test-code&state=wrong-state`).on("error", () => {});
  };

  try {
    const provider = new OAuthUserProvider({
      clientSecretPath,
      tokenPath,
      createOAuthClient: async (_installed, callbackRedirect) => new FakeOAuthClient(callbackRedirect)
    });

    await assert.rejects(provider.getAuthorizedClient(), /state/);

    await new Promise((resolve, reject) => {
      const request = http.get(redirect, () => reject(new Error("loopback server remained open")));
      request.on("error", (error) => {
        assert.equal(error.code, "ECONNREFUSED");
        resolve();
      });
    });
  } finally {
    console.error = originalConsoleError;
    await fs.rm(directory, { recursive: true, force: true });
  }
});


test("OAuthUserProvider rejects web-only OAuth credentials", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "office-auth-"));
  const clientSecretPath = path.join(directory, "client-secret.json");
  const tokenPath = path.join(directory, "token.json");

  await fs.writeFile(clientSecretPath, JSON.stringify({
    web: { client_id: "test-client", client_secret: "test-secret" }
  }));
  await fs.writeFile(tokenPath, JSON.stringify({}));

  try {
    const provider = new OAuthUserProvider({ clientSecretPath, tokenPath });
    await assert.rejects(provider.getAuthorizedClient(), /installed/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("OAuthUserProvider rejects write scopes supplied to its constructor", () => {
  assert.throws(
    () => new OAuthUserProvider({
      clientSecretPath: "/outside/client-secret.json",
      tokenPath: "/outside/token.json",
      scopes: [...READ_ONLY_SCOPES, "https://www.googleapis.com/auth/gmail.modify"]
    }),
    /read-only/
  );
});
