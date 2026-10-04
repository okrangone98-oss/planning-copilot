import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";

export const READ_ONLY_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly"
];

function validateReadOnlyScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some((scope) => !READ_ONLY_SCOPES.includes(scope))) {
    throw new Error("OAuth scopes must be a non-empty array of read-only scopes.");
  }

  return scopes;
}

async function createOAuthClient(installed, redirect) {
  const { google } = await import("googleapis");
  return new google.auth.OAuth2(installed.client_id, installed.client_secret, redirect);
}

export class MockProvider {
  constructor(client) {
    this.client = client;
  }

  async getAuthorizedClient() {
    return this.client;
  }
}

export class OAuthUserProvider {
  constructor({ clientSecretPath, tokenPath, scopes = READ_ONLY_SCOPES, port = 0, createOAuthClient: oauthClientFactory = createOAuthClient }) {
    this.clientSecretPath = clientSecretPath;
    this.tokenPath = tokenPath;
    this.scopes = validateReadOnlyScopes(scopes);
    this.port = port;
    this.createOAuthClient = oauthClientFactory;
  }

  async getAuthorizedClient() {
    const credentials = JSON.parse(await fs.readFile(this.clientSecretPath, "utf8"));
    const installed = credentials.installed;
    if (!installed) {
      throw new Error("OAuth Client Secret JSON requires installed credentials; web credentials are not supported.");
    }

    const redirect = `http://127.0.0.1:${this.port || 0}/oauth2callback`;
    const oauth2 = await this.createOAuthClient(installed, redirect);
    try {
      oauth2.setCredentials(JSON.parse(await fs.readFile(this.tokenPath, "utf8")));
      return oauth2;
    } catch {
      return authorizeWithLoopback({
        installed,
        scopes: this.scopes,
        tokenPath: this.tokenPath,
        createOAuthClient: this.createOAuthClient
      });
    }
  }
}

export function createAuthProvider(config, mode = "oauth") {
  if (mode === "mock") return new MockProvider({ kind: "mock-client" });
  if (mode !== "oauth") throw new Error(`지원하지 않는 auth mode: ${mode}`);
  return new OAuthUserProvider({
    clientSecretPath: config.clientSecretPath,
    tokenPath: config.tokenPath,
    scopes: READ_ONLY_SCOPES
  });
}

async function authorizeWithLoopback({ installed, scopes, tokenPath, createOAuthClient: oauthClientFactory = createOAuthClient }) {
  const server = http.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address();
    const redirect = `http://127.0.0.1:${port}/oauth2callback`;
    const oauth2 = await oauthClientFactory(installed, redirect);
    const state = randomBytes(32).toString("base64url");
    const authorizationUrl = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: scopes,
      state
    });
    console.error(`Google OAuth 승인 URL: ${authorizationUrl}`);
    const code = await new Promise((resolve, reject) => {
      const fail = (error) => {
        server.removeListener("error", fail);
        reject(error);
      };
      server.once("error", fail);
      server.on("request", (request, response) => {
        const callbackUrl = new URL(request.url, redirect);
        if (callbackUrl.pathname !== "/oauth2callback") {
          response.statusCode = 404;
          response.end("Not found");
          return;
        }
        const callbackState = callbackUrl.searchParams.get("state");
        if (callbackState !== state) {
          response.statusCode = 400;
          response.end("OAuth callback state가 일치하지 않습니다.");
          fail(new Error("OAuth callback state가 일치하지 않습니다."));
          return;
        }
        const error = callbackUrl.searchParams.get("error");
        const callbackCode = callbackUrl.searchParams.get("code");
        response.end(error ? "OAuth 승인이 취소되었습니다." : "OAuth 승인이 완료되었습니다. 터미널로 돌아가세요.");
        if (error) fail(new Error(`OAuth 승인 실패: ${error}`));
        else if (!callbackCode) fail(new Error("OAuth callback에 code가 없습니다."));
        else {
          server.removeListener("error", fail);
          resolve(callbackCode);
        }
      });
    });
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);
    await fs.mkdir(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
    await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    await fs.chmod(tokenPath, 0o600);
    return oauth2;
  } finally {
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}
