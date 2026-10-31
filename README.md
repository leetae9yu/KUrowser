# KUrowser

고려대 LMS 할 일을 버튼 한두 번으로 끝내는 데스크톱 앱입니다. 첫 화면에 오늘 할 일이 나오고, 앱이 대신 끝낼 수 있는 일은 「한 번에 끝내기」 한 번으로 처리합니다.

## 구조

| 부분 | 위치 | 출처 |
| --- | --- | --- |
| 화면 | `src/renderer` | lms-ux-demo |
| LMS 엔진 | `src/engine` | ku-lms-ts |
| 메인 프로세스 | `src/main` | 새로 작성, 고대 AI 연결은 ku-llm-connect |

엔진은 메인 프로세스에서 돕니다. 앱 안의 숨은 창 하나를 Electron `webContents.debugger`(CDP)로 조작하고, 학교 API는 그 창 안의 fetch로 읽습니다. 외부 Chrome이나 원격 디버깅 포트를 쓰지 않습니다.

## 하는 일

| 기능 | 동작 |
| --- | --- |
| 오늘 할 일 | 마감 과제(7일 안), 안 본 강의, 새 공지(7일 안), 새 자료(14일 안)를 모읍니다. 앱은 이 일을 한 화면에 하나씩 보여 줍니다. 과목과 과제, 공지를 먼저 보여 주고, 자료와 강의를 뒤이어 채웁니다. 자료를 다 읽기 전에 [한 번에 끝내기]를 누르면 앱은 자료를 기다렸다가 새 자료도 함께 받습니다. |
| 한 번에 끝내기 | 새 자료 받기, 새 공지 확인(AI 연결 시 한 줄 요약), 마감 하루 전 알림 켜기를 차례로 처리합니다. |
| 자료 받기 | `~/Downloads/KUrowser/<과목>/<주차 또는 게시판>/<파일>`에 저장합니다. 이미 받은 파일은 다시 받지 않습니다(`.ku-lms-materials.json`). |
| 과제 열기, 강의 보기, 공지 원문 | 앱 안 창에서 학교 화면을 엽니다. 제출과 시청은 학생이 학교 화면에서 합니다. |
| 마감 알림 | 알림을 켠 과제는 마감 24시간 전(이미 24시간 안이면 1시간 전)에 OS 알림을 띄웁니다. 앱이 켜져 있어야 합니다. 알림을 켜면 확인 알림을 바로 한 번 띄웁니다. macOS는 이때 알림 허용을 묻습니다. |
| 고대 AI 연결 | 설정에서 한 번 누르면 학교 로그인으로 Gateway 키를 받아 OS 키 저장소에 둡니다. 키는 메인 프로세스에만 있고 화면에는 끝 두 글자만 보입니다. |
| 한 문장 명령 | AI가 연결되어 있으면 문장을 읽기 명령(마감, 강의, 공지, 자료, 과목) 하나로 바꿉니다. 연결 전이나 AI가 실패하면 정해 둔 낱말 규칙으로 알아듣습니다. |

AI 호출은 크레딧을 쓰므로 학생이 누른 동작(한 번에 끝내기, 한 줄로 줄이기, 문장 입력)에서만 부릅니다. 앱을 열거나 새로 고칠 때는 부르지 않습니다.

## 막는 것

- 학교 쓰기: 숨은 엔진 창은 쓰기 요청을 보내지 못합니다. 앱은 제출, 업로드, 글쓰기, 출석이나 시청 기록 변경, 강의 재생을 하지 않습니다. 공지 읽음 표시는 앱 안에만 남기고 학교에는 보내지 않습니다.
- 허용 밖 호스트: 앱 창은 `korea.ac.kr` https 페이지만 엽니다. AI 연결은 `llm.korea.ac.kr`, `llmsso.korea.ac.kr`, `sso.korea.ac.kr`, `api.baze.co`만 씁니다.
- 비밀값: 학교 비밀번호는 앱에 들어오지 않습니다. 로그인 쿠키는 쿠키 암호화 fuse를 켠 저장소에, Gateway 키는 `safeStorage`에 둡니다.

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
| `KUROWSER_ALLOW_BASIC_TEXT=1` | 키링이 없는 개발 환경에서도 로그인 쿠키를 오래 남기고 Gateway 키를 저장합니다. 이때 값은 암호화되지 않습니다. |
| `KUROWSER_DOWNLOAD_DIR` | 자료 저장 폴더를 바꿉니다. |
| `KUROWSER_LOG_BLOCKED=1` | 엔진 창에서 막은 쓰기 요청의 호스트와 경로 모양을 출력합니다. |

## 빌드

모든 라이브러리는 `dist/`에 묶이므로 `package.json`에는 개발 의존성만 둡니다. 그래서 앱 묶음에는 `dist/`와 `package.json`만 들어갑니다.

```bash
bun run dist:linux   # release/KUrowser-<버전>-<빌드 머신 아키텍처>.AppImage
bun run dist:mac     # release/KUrowser-<버전>-arm64.dmg (자체 서명 인증서, macOS에서만 실행)
```

`dist:mac`은 macOS에서만 돌아갑니다. `scripts/dist-mac.sh`가 앱을 묶고(fuse 변경 포함), 고정 인증서 `KUrowser Dev`(자체 서명)로 서명한 뒤 dmg를 만듭니다. 그래서 앱의 지정 요구 사항(번들 id와 인증서)은 빌드마다 같습니다. 인증서는 맥미니의 빌드 전용 키체인에 있습니다. ssh 빌드에서는 로그인 키체인을 열 수 없기 때문입니다. 빌드할 때 `KUROWSER_SIGN_KEYCHAIN`과 `KUROWSER_SIGN_KEYCHAIN_PASS_FILE`로 그 키체인을 지정합니다. 키체인 비밀번호는 저장소에 두지 않습니다.

Apple 개발자 계정으로 서명하기 전까지는 아래 한계가 남습니다.

- Gatekeeper는 자체 서명 인증서를 믿지 않습니다. 처음 열 때 Finder에서 앱을 Control-클릭하고 [열기]를 누르거나, 터미널에서 `xattr -dr com.apple.quarantine /Applications/KUrowser.app`를 실행해야 합니다.
- 업데이트한 뒤 처음 열 때마다 "KUrowser Safe Storage" 키체인 허용 창이 한 번 뜹니다. 팀 ID가 없는 앱의 키체인 항목은 빌드 해시(cdhash)에 묶이기 때문입니다. 같은 자체 서명 인증서로 서명해도 이 창은 뜹니다(맥미니 securityd 로그로 확인). 학생은 맥 암호를 넣고 [항상 허용]을 눌러야 합니다. Apple 개발자 계정의 팀 ID로 서명하면 이 창이 사라집니다.
- 허용 창이 떠 있는 동안에도 앱은 창을 먼저 띄우고 "키체인 창에서 [항상 허용]을 눌러 주세요" 화면을 보여 줍니다. 학교 요청은 답을 받은 뒤에 시작합니다. [거부]하면 저장된 로그인을 읽지 못해서 "로그인을 다시 해 주세요" 화면으로 갑니다.
- 쿠키를 평문으로 두는 방법(쿠키 암호화 fuse 끄기)은 쓰지 않습니다.

Windows 설치 파일은 GitHub Actions(`.github/workflows/windows.yml`)에서 만듭니다. x64는 `windows-latest`, arm64는 `windows-11-arm` 러너에서 각각 NSIS 설치 파일(`KUrowser-<버전>-<x64|arm64>-setup.exe`)을 만들고, 설치 파일을 조용히 설치한 뒤 앱을 띄워 첫 창이 뜨는지 확인합니다(로그인 없음). `v*` 태그를 올리거나 [Run workflow]에 태그를 넣으면 두 설치 파일을 그 릴리스에 붙입니다. Actions에는 비밀값을 두지 않고, 릴리스 첨부에는 저장소 기본 토큰만 씁니다.

Windows 설치 파일은 코드 서명을 하지 않습니다. 처음 실행하면 SmartScreen이 "Windows의 PC 보호" 창을 띄웁니다. [추가 정보]를 누르고 [실행]을 눌러야 합니다. Windows에서는 학교 로그인과 실제 사용을 아직 확인하지 않았습니다.

패키징한 앱은 쿠키 암호화 fuse를 켭니다. `runAsNode`, `NODE_OPTIONS`, `--inspect`는 끄고, `app.asar`에서만 앱 코드를 읽습니다.
