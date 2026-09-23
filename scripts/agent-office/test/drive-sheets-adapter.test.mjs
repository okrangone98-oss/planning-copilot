import test from "node:test";
import assert from "node:assert/strict";
import { readProjectState } from "../lib/drive-sheets-adapter.mjs";

test("readProjectState finds the configured spreadsheet and maps Korean headers", async () => {
  const calls = [];
  const driveApi = { files: { list: async (params) => {
    calls.push({ service: "drive", method: "files.list", params });
    return { data: { files: [{ id: "sheet-1", name: "26 양터 전체사업 총괄표", webViewLink: "https://docs.google.com/spreadsheets/d/sheet-1/edit" }] } };
  } } };
  const sheetsApi = {
    spreadsheets: {
      get: async (params) => {
        calls.push({ service: "sheets", method: "spreadsheets.get", params });
        return { data: { sheets: [{ properties: { title: "전체사업" } }] } };
      },
      values: { get: async (params) => {
        calls.push({ service: "sheets", method: "spreadsheets.values.get", params });
        return { data: { values: [
          ["사업명", "일정", "상태"],
          ["웰컴센터", "2026-10-09", "준비 중"],
          ["", "2026-10-10", "빈 행"]
        ] } };
      } }
    }
  };

  const projects = await readProjectState({ driveApi, sheetsApi, spreadsheetTitle: "26 양터 전체사업 총괄표", detectedAt: "2026-09-24T03:00:00.000Z" });

  assert.deepEqual(calls, [
    { service: "drive", method: "files.list", params: {
      q: "name = '26 양터 전체사업 총괄표' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false",
      fields: "files(id,name,webViewLink)"
    } },
    { service: "sheets", method: "spreadsheets.get", params: { spreadsheetId: "sheet-1", fields: "sheets.properties.title,spreadsheetUrl" } },
    { service: "sheets", method: "spreadsheets.values.get", params: { spreadsheetId: "sheet-1", range: "'전체사업'!A:ZZ" } }
  ]);
  assert.deepEqual(projects, [{
    name: "웰컴센터",
    deadlineText: "2026-10-09",
    deadline: "2026-10-09",
    statusText: "준비 중",
    source: {
      sourceType: "sheets",
      sourceId: "sheet-1",
      sourceUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
      detectedAt: "2026-09-24T03:00:00.000Z"
    }
  }]);
});

test("readProjectState uses the configured spreadsheet and requested sheet without Drive", async () => {
  const calls = [];
  const sheetsApi = { spreadsheets: {
    get: async (params) => {
      calls.push({ method: "get", params });
      return { data: { sheets: [{ properties: { title: "요청 시트" } }], spreadsheetUrl: "https://docs.google.com/spreadsheets/d/configured/edit" } };
    },
    values: { get: async (params) => {
      calls.push({ method: "values.get", params });
      return { data: { values: [["사업 명칭", "마감일", "진행상태"], ["성과공유회", "2026년 10월 12일", "진행"]] } };
    } }
  }};

  const projects = await readProjectState({ driveApi: { files: { list: async () => assert.fail("Drive must not be called") } }, sheetsApi, spreadsheetId: "configured", sheetName: "요청 시트", detectedAt: "detected" });

  assert.deepEqual(calls, [
    { method: "get", params: { spreadsheetId: "configured", fields: "sheets.properties.title,spreadsheetUrl" } },
    { method: "values.get", params: { spreadsheetId: "configured", range: "'요청 시트'!A:ZZ" } }
  ]);
  assert.equal(projects[0].deadlineText, "2026년 10월 12일");
  assert.equal(projects[0].deadline, "2026-10-12");
  assert.equal(projects[0].source.sourceUrl, "https://docs.google.com/spreadsheets/d/configured/edit");
});

test("readProjectState safely returns no projects for missing files, sheets, and malformed values", async () => {
  const noFile = await readProjectState({ driveApi: { files: { list: async () => ({ data: { files: [] } }) } }, sheetsApi: {}, spreadsheetTitle: "없음" });
  const noSheets = await readProjectState({ sheetsApi: { spreadsheets: { get: async () => ({ data: { sheets: [] } }) } }, spreadsheetId: "sheet-1" });
  const malformed = await readProjectState({ sheetsApi: { spreadsheets: {
    get: async () => ({ data: { sheets: [{ properties: { title: "전체" } }] } }),
    values: { get: async () => ({ data: { values: { unexpected: true } } }) }
  } }, spreadsheetId: "sheet-1" });
  assert.deepEqual(noFile, []);
  assert.deepEqual(noSheets, []);
  assert.deepEqual(malformed, []);
});
