# 📞 채팅상담 모의상담 시스템

LLM이 까다로운 고객을 연기하고, 사용자가 상담사가 되어 응대를 연습하는 **채팅상담 면접 모의훈련 도구**입니다. 상담을 마치면 응대 내용을 **자동으로 평가한 평가서**를 받아 저장·다운로드할 수 있습니다.

- 🖥️ 웹 UI (채팅 + 평가서 + 평가 기록)
- 🧠 LLM 백엔드: **OpenAI(gpt-4o-mini)** 또는 **로컬 Ollama** 자동 선택
- 📊 7개 항목 자동 평가 (고객 니즈 파악 · 답변 정확성 · 맞춤법/오타 · 가독성 · 논점 유지 · 응대 태도 · 마무리)

## 🚀 시작하기

### 1. 의존성 설치
```bash
npm install
```

### 2. LLM 백엔드 선택 (`.env`)
`.env.example`을 복사해 `.env`를 만들고 둘 중 하나로 설정합니다.

**A. OpenAI 사용 (배포 권장)**
```
OPENAI_API_KEY=sk-...your_key...
OPENAI_MODEL=gpt-4o-mini
```

**B. 로컬 Ollama 사용 (무료, 키 불필요)**
`OPENAI_API_KEY`를 비워 두면 자동으로 Ollama로 폴백합니다.
```
OPENAI_API_KEY=
OLLAMA_MODEL=exaone3.5:7.8b
```
> Ollama를 쓰려면 [Ollama](https://ollama.com/download) 설치 후 `ollama pull exaone3.5:7.8b`, 그리고 서버 실행(`ollama serve` 또는 데스크톱 앱)이 필요합니다.

### 3. 실행
```bash
npm start          # 웹 서버 → http://localhost:3000
```
CLI 버전(터미널 대화)도 있습니다:
```bash
npm run cli
```

## 📋 사용 방법
1. **시나리오 + 고객 페르소나 선택** → 상담 시작
2. 챗봇이 브랜드명·관리자 ID로 상담을 접수하면, 고객(AI)이 문의를 남깁니다
3. **상담사로 응대** (Enter 전송 / Shift+Enter 줄바꿈)
4. **상담 종료** → 평가서 자동 생성 → **평가서 저장(다운로드)** 가능
5. 메인 화면의 **📋 지난 평가 기록 보기** 에서 과거 평가서를 다시 열람

## 📁 파일 구조
```
chat-counsel-simulator/
├── server.js              # Express 서버 (API + 정적 서빙)
├── src/
│   ├── index.js           # CLI 진입점
│   ├── simulator.js       # 상담 로직 / 데이터 로드
│   └── llmClient.js       # LLM 연동(OpenAI/Ollama) + 응답 정제 + 평가
├── config/
│   ├── scenarios.json     # 시나리오
│   └── personas.json      # 고객 페르소나
├── public/                # 웹 프론트엔드 (index.html, app.js, style.css)
├── data/evaluations/      # 저장된 평가서 (gitignore)
└── .env                   # 환경설정
```

## ☁️ 배포 (Render 예시)
Node/Express 앱이라 Render·Railway·Fly.io 등에 쉽게 올라갑니다. **OpenAI 백엔드 사용을 권장**합니다(로컬 Ollama는 배포 서버에서 모델 구동이 필요해 비현실적).

1. 코드를 GitHub 저장소에 푸시 (`.env`는 커밋되지 않음)
2. [Render](https://render.com) → **New → Web Service** → 저장소 연결
3. 설정값:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. **Environment**에 변수 추가:
   - `OPENAI_API_KEY` = 본인 키
   - `OPENAI_MODEL` = `gpt-4o-mini`
   - (`PORT`는 Render가 자동 주입하므로 설정 불필요)
5. 배포 후 발급된 URL로 접속

> ⚠️ **평가서 영속성**: 평가서는 서버의 `data/` 폴더에 파일로 저장됩니다. Render의 기본 파일시스템은 재배포 시 초기화되므로, 영구 보관이 필요하면 [Persistent Disk](https://render.com/docs/disks)를 연결하거나 외부 DB로 전환하세요. (각 평가서는 다운로드로도 보관 가능합니다.)

## ⚠️ 참고
- OpenAI 사용 시 API 호출당 비용이 발생합니다 (gpt-4o-mini는 평가 1건당 소액).
- 고객 응답은 1~2문장의 가벼운 톤으로 제한되며, 영어 혼입·마크다운·욕설 표현 등은 후처리로 정리됩니다.

## 🔧 커스터마이징
### 시나리오 추가 — `config/scenarios.json`
```json
{ "id": "unique_id", "name": "이름", "description": "설명", "context": "상황", "difficulty": "easy|medium|hard" }
```
### 페르소나 추가 — `config/personas.json`
```json
{ "id": "unique_id", "name": "이름", "age": "나이", "personality": "성격", "tone": "말투", "traits": ["특징"], "background": "배경" }
```
