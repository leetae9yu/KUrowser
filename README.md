# KUrowser

고려대 LMS 할 일을 버튼 한두 번으로 끝내는 데스크톱 앱입니다. 첫 화면에 오늘 할 일이 나오고, 앱이 대신 끝낼 수 있는 일은 「한 번에 끝내기」 한 번으로 처리합니다.

## 구조

| 부분 | 위치 | 출처 |
| --- | --- | --- |
| 화면 | `src/renderer` | lms-ux-demo |
| LMS 엔진 | `src/engine` | ku-lms-ts |
| 메인 프로세스 | `src/main` | 새로 작성, 고대 AI 연결은 ku-llm-connect |

엔진은 메인 프로세스에서 돕니다. 앱 안의 숨은 창 하나를 Electron `webContents.debugger`(CDP)로 조작하고, 학교 API는 그 창 안의 fetch로 읽습니다. 외부 Chrome이나 원격 디버깅 포트를 쓰지 않습니다.

## 로그인

학생은 앱이 연 학교 로그인 창에서 한 번 로그인합니다. 앱은 비밀번호를 받거나 저장하지 않습니다. 로그인 세션은 앱 전용 저장소(`persist:kurowser`)에 남고, 앱을 다시 열어도 유지됩니다. 학교 쿠키는 세션 쿠키라서 앱이 로그인 직후 만료일 14일을 붙여 다시 저장합니다.

## 개발

```bash
bun install
bun run build       # dist/main, dist/renderer
bun run typecheck
bun test
node_modules/.bin/electron .
```

개발 실행에서만 쓰는 환경 변수입니다. 패키징한 앱은 이 값을 읽지 않습니다.

| 변수 | 뜻 |
| --- | --- |
| `KUROWSER_DEV_ENV_FILE` | 숨은 엔진 창이 이 파일의 `KU_LMS_ID`, `KU_LMS_PWD`로 로그인합니다. 서버 시험용입니다. |
| `KUROWSER_PROBE=attendance` | 창을 띄우지 않고 엔진 연결을 확인한 뒤 결과 모양(키 이름, 개수)만 출력하고 끝냅니다. |
| `KUROWSER_LOG_BLOCKED=1` | 엔진 창에서 막은 쓰기 요청의 호스트와 경로 모양을 출력합니다. |
