# MBC 파견근로자 사전교육

에이스휴먼파워(주) — 파견근로자 입사 전 7분 사전투입교육 + 이수 인증 + 관리자 확인

## 화면
| 주소 | 용도 |
|---|---|
| `/` | 근로자용 교육 (정보 입력 → 9개 화면 시청 → 퀴즈 5문항 → 서약·서명 → 이수증) |
| `/admin` | 관리자 이수 현황 (검색·필터·서명 확인·CSV 다운로드·삭제) |
| `/verify` | 현장 관리자용 이수번호 진위 확인 (이름 일부 가림) |

## 부정 시청 방지
- 화면마다 정해진 시간이 지나야 다음으로 넘어감 (총 약 5분)
- 탭을 내리거나 화면을 끄면 시청 시간이 멈춤
- 서버가 "교육 시작 후 실제 경과시간"과 "시청 보고 시간"을 둘 다 확인 → 최소 시청시간(기본 4분 20초) 미만이면 퀴즈 응시 불가
- 퀴즈 정답은 서버에만 있음 (5문항 중 4문항 통과)

## Railway 배포 (연차관리 시스템과 같은 방식)
1. GitHub에 새 저장소 만들고 이 폴더 전체 push
2. Railway → New Project → Deploy from GitHub repo
3. 같은 프로젝트에 **+ New → Database → PostgreSQL** 추가
4. 앱 서비스 Variables에 아래 입력
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (참조 변수)
   - `ADMIN_PASSWORD` = 관리자 비밀번호 (**반드시 변경**)
   - `SESSION_SECRET` = 임의의 긴 문자열
5. Settings → Networking → Generate Domain → 주소를 근로자에게 문자/카톡으로 발송

> Postgres 없이 실행하면 `data/records.json` 파일에 저장되는데, Railway는 재배포 때 파일이 지워지므로 운영에서는 Postgres를 꼭 연결하세요.

## 선택 환경변수
| 변수 | 기본값 | 설명 |
|---|---|---|
| `CLIENT_NAME` | 문화방송 | 화면에 표시되는 고객사명 |
| `AGENCY_NAME` | 에이스휴먼파워 | 파견사명 |
| `SITES` | (없음) | 투입 부서 자동완성 목록, 쉼표로 구분 (예: `보도국,예능국,드라마국`) |
| `MIN_WATCH_SECONDS` | 360 | 퀴즈 응시에 필요한 최소 시청시간(초) |
| `CERT_PREFIX` | 문화방송 | 이수번호 앞자리 |
| `PGSSL` | (없음) | 외부 Postgres 주소로 접속 시 `require` |

## 교육 내용 수정
`public/index.html`의 `buildSlides()` 안 각 화면의 `title`, `key`, `narr`, `rules`, `sec`(화면 최소 시간)를 고치면 됩니다.
퀴즈는 `server.js` 상단 `QUIZ` 배열에서 수정합니다.

## 로컬 실행
```
npm install
ADMIN_PASSWORD=test npm start   # http://localhost:3000
```


| `CONTACTS` | (없음) | 마지막 화면 '첫 출근 때 확인' 연락처 목록, `\|`로 구분 (예: `보안데스크: 02-000-0000|현장 책임자: 홍길동 010-0000-0000`) |
