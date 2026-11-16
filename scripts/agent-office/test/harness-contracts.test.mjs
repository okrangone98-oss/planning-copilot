import test from "node:test";
import assert from "node:assert/strict";
import { MAX_RETRIES, RetryableStepError, isRetryableStepError, transitionStatus } from "../lib/harness-contracts.mjs";

test("run status accepts only declared transitions", () => {
  assert.equal(transitionStatus("QUEUED", "RUNNING"), "RUNNING");
  assert.equal(transitionStatus("RUNNING", "WAITING_APPROVAL"), "WAITING_APPROVAL");
  assert.throws(() => transitionStatus("SUCCEEDED", "RUNNING"), /허용되지 않는 상태 전이/);
});

test("only explicit retryable errors receive the bounded retry budget", () => {
  assert.equal(MAX_RETRIES, 2);
  assert.equal(isRetryableStepError(new RetryableStepError("일시 오류")), true);
  assert.equal(isRetryableStepError(new Error("인증 오류")), false);
});
