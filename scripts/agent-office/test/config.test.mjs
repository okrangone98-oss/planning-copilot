import test from "node:test";
import assert from "node:assert/strict";
import { loadBriefingConfig } from "../lib/config.mjs";

test("loadBriefingConfig requires OAuth secret and token paths", () => {
  assert.throws(
    () => loadBriefingConfig({}),
    /GOOGLE_OAUTH_CLIENT_SECRET_PATH.*GOOGLE_OAUTH_TOKEN_PATH/
  );
});

test("loadBriefingConfig applies safe read-only defaults", () => {
  const config = loadBriefingConfig({
    GOOGLE_OAUTH_CLIENT_SECRET_PATH: "/outside/client-secret.json",
    GOOGLE_OAUTH_TOKEN_PATH: "/outside/google-token.json"
  });

  assert.equal(config.calendarId, "primary");
  assert.equal(config.timezone, "Asia/Seoul");
  assert.equal(config.outputDir, "reports/private");
  assert.equal(config.sheetName, "");
});

test("loadBriefingConfig rejects OAuth paths inside the repository", () => {
  assert.throws(
    () => loadBriefingConfig({
      GOOGLE_OAUTH_CLIENT_SECRET_PATH: "./client-secret.json",
      GOOGLE_OAUTH_TOKEN_PATH: "/outside/google-token.json"
    }),
    /repository/
  );
});
