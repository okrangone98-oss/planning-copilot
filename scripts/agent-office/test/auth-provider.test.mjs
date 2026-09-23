import test from "node:test";
import assert from "node:assert/strict";
import { MockProvider } from "../lib/auth-provider.mjs";

test("MockProvider returns its injected client without changing it", async () => {
  const client = { kind: "mock-google-client" };
  const provider = new MockProvider(client);

  assert.equal(await provider.getAuthorizedClient(), client);
});
