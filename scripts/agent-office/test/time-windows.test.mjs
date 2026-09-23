import test from "node:test";
import assert from "node:assert/strict";
import { getTimeWindows } from "../lib/time-windows.mjs";

test("getTimeWindows uses Asia/Seoul midnight for today and future windows", () => {
  const windows = getTimeWindows(new Date("2026-09-24T00:30:00+09:00"), "Asia/Seoul");

  assert.equal(windows.todayStart.toISOString(), "2026-09-23T15:00:00.000Z");
  assert.equal(windows.tomorrowStart.toISOString(), "2026-09-24T15:00:00.000Z");
  assert.equal(windows.sevenDayEnd.toISOString(), "2026-09-30T15:00:00.000Z");
  assert.equal(windows.thirtyDayEnd.toISOString(), "2026-10-23T15:00:00.000Z");
});

test("getTimeWindows returns a week boundary that excludes next week", () => {
  const windows = getTimeWindows(new Date("2026-09-24T12:00:00+09:00"), "Asia/Seoul");
  assert.equal(windows.weekEnd.toISOString(), "2026-09-27T15:00:00.000Z");
});
