# Google Sheets 에이전트 설정

이 코드는 서비스 계정 JSON 키를 브라우저에 넣지 않고, 로컬 PC나 서버에서만 실행합니다.

## 1. API 켜기

GCP 콘솔에서 아래 API를 사용 설정합니다.

- Google Sheets API
- Google Drive API

## 2. 키 파일 보관

다운로드한 서비스 계정 JSON 파일은 저장소 밖이나 `secrets/` 폴더에 둡니다.

예:

```powershell
C:\Users\samsung\OneDrive\문서\사업계획서1\secrets\service-account.json
```

`secrets/`와 `service-account*.json`은 `.gitignore`에 들어 있어 GitHub에 올라가지 않습니다.

## 3. 환경 변수 설정

`.env.example`을 참고해 `.env.local`을 만들거나, 서버 환경 변수에 값을 넣습니다.

필수:

```powershell
GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
GOOGLE_SHARE_WITH_EMAIL=내구글계정@gmail.com
```

선택:

```powershell
GOOGLE_TEMPLATE_SPREADSHEET_ID=기존_시트_템플릿_ID
PLANNING_COPILOT_ARCHIVE=백업탭에서_받은_archive.json
```

## 4. 실행

```powershell
npm install
npm run sheets:create
```

실행이 끝나면 새 Google Sheet가 만들어지고, `GOOGLE_SHARE_WITH_EMAIL` 계정에 편집 권한으로 자동 공유됩니다.

## 보안 원칙

- JSON 키를 `index.html`이나 `assets/app.js`에 넣지 않습니다.
- JSON 키를 GitHub에 올리지 않습니다.
- GitHub Pages에서는 서비스 계정 키를 직접 사용할 수 없습니다.
- 실제 자동화는 로컬 PC, 서버, GitHub Actions Secrets, Cloud Run, Vercel Functions 같은 안전한 실행 환경에서 돌립니다.
