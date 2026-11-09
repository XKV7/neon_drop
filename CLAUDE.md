# CLAUDE.md — 네온 낙하 (Neon Drop)

## 대화 규칙

- **사용자와는 항상 한국어로 대화한다.** 답변, 진행 보고, 질문, 요약 모두 한국어로 쓴다.
- 커밋 메시지와 코드 주석도 한국어로 쓴다(기존 스타일 유지).
- 사용자는 비개발자에 가까우므로 결과는 "무엇이 바뀌었고, 어떻게 확인하는지" 위주로 짧게 설명한다.
- 사용자가 "반영해줘"라고 하면 작업 브랜치에 푸시한 뒤 `main`에도 반영한다(`git push origin <작업 브랜치>:main`). `main`에 푸시하면 GitHub Pages와 Render가 자동으로 다시 배포된다.
- **무료 요금제만 사용한다.** 유료 서비스(Firebase Blaze, Cloud Run 등)가 필요한 방법은 제안하지 않는다.
- 서비스 계정 JSON 같은 비밀 값은 절대 저장소에 커밋하지 않고 채팅에 붙여 넣으라고 하지 않는다.

## 게임 개요

웹 멀티플레이 쿼터뷰 3D 핵앤슬래시 배틀로얄. 최대 10명(빈자리는 봇), 한 판 평균 약 4.5분(최대 약 6.5분).

- **배포(라이브)**: 클라이언트 https://xkv7.github.io/neon_drop/ (GitHub Pages) · 게임 서버 Render 무료(싱가포르, Docker, `render.yaml`) · 계정 저장 Firestore(Spark 무료, `STORE=firestore`)
- GitHub 변수 `SERVER_URL`이 있으면 온라인 빌드, 없으면 오프라인(봇 전용) 빌드가 Pages에 올라간다.
- 오프라인 체험판(Claude 아티팩트): https://claude.ai/artifact/Fy7TitycHFSL8FGF3svwrg

## 구조

npm workspaces 모노레포.

- `shared/` — 결정적 시뮬레이션(`@neon/shared`, TS 소스 그대로 import). 영웅·스킬(데이터 기반 SkillDef/Action/Effect), 증강, 맵, 자기장, 시야, 봇 AI, 네트워크 코덱(바이너리 델타 스냅샷), `MatchHost`(클라이언트별 스냅샷·시야 컬링·입력 큐·관전자).
- `server/` — Node + ws, 30Hz 서버 권한. `Lobby`(빠른 매칭 20초+봇, 사설 방, 영웅 선택 15초, 동시 진행 최대 `MAX_MATCHES`판, 넘치면 대기열 관전), `MatchRunner`(30Hz 루프, 따라잡을 때는 마지막 틱만 스냅샷), `AccountStore`(SQLite 또는 Firestore). esbuild로 번들.
- `client/` — Vite + TypeScript + Three.js. `main.ts`(앱 상태 머신·메뉴·설정·키 설정), `game/clientGame.ts`(예측/재조정/보간, 지터에 따른 보간 지연, 짧은 외삽), `game/input.ts`(키 바인딩·보조 키·키보드 스킬 자동 조준용 `kbSlot`), `game/touch.ts`(조이스틱·스킬 버튼, 낙하 모드), `render/`(렌더러·자동 해상도·포스트·셰이더·네온 강도), `ui/hud.ts`, `net/local.ts`(연습장/오프라인).
- `scripts/` — `dev.mjs`, `balance.ts`(2000판 밸런스), `e2e.mjs`, `e2e-queue.mjs`, `docs.ts`, 배포 스크립트.

## 명령어

```bash
npm run dev          # 개발 서버(클라이언트+서버)
npm run typecheck    # 타입 검사 (shared/server/client)
npm test             # vitest (41 통과, 1 건너뜀: Firestore 에뮬레이터 전용)
npm run build        # 클라이언트 + 서버 빌드
npm run e2e          # Playwright 2인 E2E (기본 + 지연/손실)
npm run e2e:queue    # 대기열/관전 E2E
npm run balance      # 2000판 밸런스 시뮬레이션
npm run docs         # README의 영웅/밸런스 표 갱신
```

변경 후에는 최소 `typecheck` → `test` → `build`를 통과시키고, 게임 흐름에 영향이 있으면 `e2e`도 돌린다. E2E는 `docs/screenshots/`를 덮어쓰므로 의도한 변경이 아니면 `git checkout docs/screenshots`로 되돌린다.

## 진행도 (완료된 것)

- [x] 8영웅(4역할 × 2), 기본 공격 + 스킬 3 + 궁극기, 증강(공통 30+ / 영웅 전용 24, 실버·골드·프리즘)
- [x] 약 80m 맵(구역, 파괴 오브젝트, 수풀, 점프 패드, 텔레포트 게이트, 전장의 안개), 낙하 단계, 60초마다 자기장, 보급품, 자판기, 관전
- [x] 서버 권한 30Hz(스냅샷 15Hz, `SNAPSHOT_EVERY`), 예측/재조정, 133ms 보간(지터에 따라 자동 증가), 지연 보상 ≤150ms, 델타 바이너리 스냅샷, 시야 컬링, `?lag=&loss=`, 20초 재접속
- [x] 봇 3단계 난이도, 밸런스(2000판 기준 전 영웅 ±14% 이내)
- [x] 게스트 토큰 계정, 계정 레벨, 상점/코스메틱/프로필, 채팅·퀵 채팅·감정 표현·킬 피드
- [x] 사설 방은 "준비 중" 표시(환경 변수 `PRIVATE_ROOM_MIN_LEVEL`로 레벨 제한 개방 가능), 동시 진행 최대 2판, 못 들어온 사람은 대기열에서 관전
- [x] 반응형(휴대폰/태블릿/PC), 터치 조작(플로팅 조이스틱, 드래그 조준 스킬 버튼, 낙하 단계에선 숨김)
- [x] 키보드만으로 플레이(가까운 적 자동 조준, 키보드 낙하), 키보드 키로 쓴 스킬은 사거리 안 가장 가까운 적 자동 조준(설정에서 끄기 가능)
- [x] 키 설정: Esc를 제외한 모든 키 변경 가능(이동·공격·스킬·구르기·상호작용·점수판·채팅·퀵 채팅·증강 선택 1~3·관전 이전/다음·디버그), 마우스 버튼 지정 가능, 충돌 시 서로 교체
- [x] 네온 빛 강도 조절, 그래픽 품질, 자동 해상도(렉 완화), F3 디버그(FPS·핑·지터·보간·해상도)
- [x] 무료 배포: GitHub Pages + Render 무료 + Firestore Spark, GitHub Actions(`ci.yml`, `pages.yml`)
- [x] 입력 속도 제한을 실제 시간 기준으로 변경(서버가 느릴 때 스킬·낙하 입력이 사라지던 버그 수정), 키보드 스킬 항상 즉발, 낙하 표시는 마우스 사용 중에도 WASD로 이동
- [x] 영웅 선택·설정 화면에서 다시 그릴 때 스크롤이 위로 튀던 문제 수정

## 알아둘 점

- Render 무료 서버는 CPU 0.1개: 10명 한 판 ≈ 허용치의 45%. 그래서 동시 진행을 2판으로 제한한다. 15분 동안 접속이 없으면 잠들어 첫 접속이 느리다.
- 서버 입력 큐: `MatchHost.receiveBinary`의 속도 제한은 `performance.now()` 기준(초당 60개). 서버 틱 기준으로 바꾸면 서버가 느릴 때 입력이 버려진다.
- 같은 화면을 다시 그릴 때는 `App.render()`가 스크롤을 유지한다. 키 목록만 바뀔 때는 `refreshKeyUi()`로 `.keybinds`만 갱신한다.
- 새 키 동작을 추가할 때는 `client/src/settings.ts`의 `ACTIONS`·`DEFAULT_KEYS`에 넣고, 기존 저장 설정과 충돌하면 `loadSettings()`가 그 동작을 '없음'으로 둔다.
- `.gitignore`의 `/data/`는 루트만 무시한다(`shared/src/data`는 커밋 대상).

## 다음에 할 수 있는 것 (미정)

- 사설 방 정식 오픈(레벨 제한 값 결정)
- 실제 사용자 핑/FPS를 보고 추가 렉 완화(스냅샷 빈도 조절 등)
