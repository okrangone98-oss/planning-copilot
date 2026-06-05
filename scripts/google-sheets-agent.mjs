import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive"
];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} 환경 변수가 필요합니다.`);
  }
  return value;
}

async function loadArchive() {
  const archivePath = process.env.PLANNING_COPILOT_ARCHIVE;
  if (!archivePath) return null;

  const raw = await fs.readFile(archivePath, "utf8");
  return JSON.parse(raw);
}

function rowsFromText(label, value) {
  if (!value) return [[label, ""]];
  return String(value)
    .split(/\n+/)
    .map((line, index) => [index === 0 ? label : "", line.trim()])
    .filter((row) => row[1]);
}

function buildWorkbookData(archive) {
  const project = archive?.project || {};
  const knowledgeDocs = archive?.knowledgeDocs || [];

  return {
    title: project.projectName || `사업계획서 코파일럿 ${new Date().toISOString().slice(0, 10)}`,
    sheets: [
      {
        title: "공고 해석",
        rows: [
          ["항목", "내용"],
          ...rowsFromText("정책 목적", project.policyGoal),
          ...rowsFromText("평가 포인트", project.evaluationFocus),
          ...rowsFromText("필수 조건", project.requirements),
          ...rowsFromText("차별화 기회", project.advantageSignals)
        ]
      },
      {
        title: "아이디어",
        rows: [
          ["항목", "내용"],
          ...rowsFromText("핵심 아이디어", project.coreIdea),
          ...rowsFromText("대상자", project.targetUsers),
          ...rowsFromText("현장 근거", project.fieldEvidence),
          ...rowsFromText("고유한 관점", project.founderInsight)
        ]
      },
      {
        title: "문제정의",
        rows: [
          ["항목", "내용"],
          ...rowsFromText("문제 상황", project.problemSituation),
          ...rowsFromText("원인 분석", project.rootCauses),
          ...rowsFromText("기존 해결책의 한계", project.existingLimits),
          ...rowsFromText("지금 필요한 이유", project.whyNow)
        ]
      },
      {
        title: "성과지표",
        rows: [
          ["구분", "지표명", "목표값", "측정 방법"],
          ...(project.metricsTable || [])
        ]
      },
      {
        title: "실행설계",
        rows: [
          ["항목", "내용"],
          ...rowsFromText("추진 단계", project.milestones),
          ...rowsFromText("추진체계", project.teamSystem),
          ...rowsFromText("예산 설계", project.budgetPlan),
          ...rowsFromText("리스크 대응", project.riskPlan)
        ]
      },
      {
        title: "저장한 사례",
        rows: [
          ["제목", "유형", "내용"],
          ...knowledgeDocs.map((doc) => [doc.title || "", doc.type || "", doc.text || ""])
        ]
      },
      {
        title: "초안",
        rows: [
          ["내용"],
          ...String(project.draftOutput || "")
            .split(/\n+/)
            .map((line) => [line])
        ]
      }
    ]
  };
}

async function getClients() {
  requiredEnv("GOOGLE_APPLICATION_CREDENTIALS");
  const auth = new google.auth.GoogleAuth({ scopes: SCOPES });
  const authClient = await auth.getClient();
  return {
    sheets: google.sheets({ version: "v4", auth: authClient }),
    drive: google.drive({ version: "v3", auth: authClient })
  };
}

async function createSpreadsheet(sheets, workbook) {
  const response = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: workbook.title },
      sheets: workbook.sheets.map((sheet) => ({
        properties: { title: sheet.title }
      }))
    }
  });
  return response.data.spreadsheetId;
}

async function copyTemplate(drive, workbook) {
  const templateId = process.env.GOOGLE_TEMPLATE_SPREADSHEET_ID;
  if (!templateId) return null;

  const response = await drive.files.copy({
    fileId: templateId,
    requestBody: {
      name: workbook.title,
      mimeType: "application/vnd.google-apps.spreadsheet"
    },
    fields: "id"
  });
  return response.data.id;
}

async function ensureSheets(sheets, spreadsheetId, workbook) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTitles = new Set(spreadsheet.data.sheets.map((sheet) => sheet.properties.title));
  const requests = workbook.sheets
    .filter((sheet) => !existingTitles.has(sheet.title))
    .map((sheet) => ({ addSheet: { properties: { title: sheet.title } } }));

  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests }
    });
  }
}

async function writeWorkbook(sheets, spreadsheetId, workbook) {
  await ensureSheets(sheets, spreadsheetId, workbook);

  const data = workbook.sheets.map((sheet) => ({
    range: `'${sheet.title}'!A1`,
    values: sheet.rows.length ? sheet.rows : [[""]]
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data
    }
  });
}

async function shareWithUser(drive, spreadsheetId) {
  const emailAddress = requiredEnv("GOOGLE_SHARE_WITH_EMAIL");
  await drive.permissions.create({
    fileId: spreadsheetId,
    sendNotificationEmail: true,
    requestBody: {
      type: "user",
      role: "writer",
      emailAddress
    }
  });
}

async function main() {
  const archive = await loadArchive();
  const workbook = buildWorkbookData(archive);
  const { sheets, drive } = await getClients();

  const spreadsheetId = (await copyTemplate(drive, workbook)) || (await createSpreadsheet(sheets, workbook));
  await writeWorkbook(sheets, spreadsheetId, workbook);
  await shareWithUser(drive, spreadsheetId);

  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  console.log(`시트 생성 완료: ${url}`);
  console.log(`공유 대상: ${process.env.GOOGLE_SHARE_WITH_EMAIL}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
