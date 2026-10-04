import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

test("loadBriefingConfig rejects an absolute repository secret path from an external cwd", () => {
  const originalCwd = process.cwd();
  const externalCwd = fs.mkdtempSync(path.join(os.tmpdir(), "office-config-"));

  try {
    process.chdir(externalCwd);

    assert.throws(
      () => loadBriefingConfig({
        GOOGLE_OAUTH_CLIENT_SECRET_PATH: fileURLToPath(import.meta.url),
        GOOGLE_OAUTH_TOKEN_PATH: "/outside/google-token.json"
      }),
      /repository/
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(externalCwd, { recursive: true, force: true });
  }
});

test("loadBriefingConfig rejects a missing token path through a symlinked repository directory", () => {
  const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "office-config-"));
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const repositoryLink = path.join(externalDirectory, "repository-link");

  try {
    fs.symlinkSync(repositoryRoot, repositoryLink, "dir");

    assert.throws(
      () => loadBriefingConfig({
        GOOGLE_OAUTH_CLIENT_SECRET_PATH: path.join(externalDirectory, "client-secret.json"),
        GOOGLE_OAUTH_TOKEN_PATH: path.join(repositoryLink, "new-token.json")
      }),
      /repository/
    );
  } finally {
    fs.rmSync(externalDirectory, { recursive: true, force: true });
  }
});

test("loadBriefingConfig rejects a dangling external token symlink into the repository", () => {
  const externalDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "office-config-"));
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const repositoryTokenPath = path.join(repositoryRoot, `.token-${process.pid}.json`);
  const tokenLink = path.join(externalDirectory, "token.json");

  try {
    assert.equal(fs.existsSync(repositoryTokenPath), false);
    fs.symlinkSync(repositoryTokenPath, tokenLink, "file");

    assert.throws(
      () => loadBriefingConfig({
        GOOGLE_OAUTH_CLIENT_SECRET_PATH: path.join(externalDirectory, "client-secret.json"),
        GOOGLE_OAUTH_TOKEN_PATH: tokenLink
      }),
      /symlink/
    );
  } finally {
    fs.rmSync(externalDirectory, { recursive: true, force: true });
  }
});
