# 📞 채팅상담 모의상담 시스템

OpenAI API를 활용한 채팅상담 면접 모의상담 시스템입니다.

## 🚀 시작하기

### 1. 설치
```bash
npm install
```

### 2. OpenAI API 키 설정
`.env` 파일을 열어 OpenAI API 키를 입력하세요:
```
OPENAI_API_KEY=your_actual_api_key_here
```

### 3. 실행
```bash
npm start
```

또는

```bash
node src/index.js
```

## 📋 사용 방법

1. **시나리오 선택**: 5가지 상담 시나리오 중 선택
   - 결제 취소 요청
   - 제품 불량 신고
   - 배송 지연 불만
   - 중복 결제 문제
   - 서비스 품질 불만

2. **고객 페르소나 선택**: 4가지 페르소나 중 선택
   - 김화남 (짜증나는 성격)
   - 이인영 (차분한 성격)
   - 박불안 (불안한 성격)
   - 최까칠 (까다로운 성격)

3. **상담 진행**: 상담사로서 고객과 대화
   - 고객이 자동으로 응답합니다
   - `quit` 입력으로 상담 종료

## 📁 파일 구조
```
chat-counsel-simulator/
├── src/
│   ├── index.js           # 메인 진입점
│   ├── simulator.js       # 상담 로직
│   └── openaiClient.js    # OpenAI API 연동
├── config/
│   ├── scenarios.json     # 시나리오 데이터
│   └── personas.json      # 고객 페르소나
├── .env                   # API 키 설정
└── package.json
```

## 🎯 주요 기능

- ✅ AI 기반 동적 고객 응답 생성
- ✅ 5가지 실제 상담 시나리오
- ✅ 4가지 다양한 고객 페르소나
- ✅ 실시간 대화 진행
- ✅ 난이도별 시나리오

## 💡 팁

- 상담 중 자연스러운 대화로 고객의 요청을 이해하고 해결책을 제시해보세요
- 각 페르소나의 특징에 맞게 반응하는 고객의 모습을 관찰하세요
- 여러 시나리오와 페르소나 조합을 시도해보세요

## ⚠️ 주의사항

- OpenAI API 사용에 비용이 발생할 수 있습니다
- 인터넷 연결이 필요합니다
- API 응답 시간은 네트워크 상태에 따라 달라질 수 있습니다

## 🔧 커스터마이징

### 새로운 시나리오 추가
`config/scenarios.json`에 다음 형식으로 추가:
```json
{
  "id": "unique_id",
  "name": "시나리오 이름",
  "description": "설명",
  "context": "상황 설정",
  "difficulty": "easy|medium|hard"
}
```

### 새로운 페르소나 추가
`config/personas.json`에 다음 형식으로 추가:
```json
{
  "id": "unique_id",
  "name": "이름",
  "age": "나이",
  "personality": "성격",
  "tone": "말투",
  "traits": ["특징1", "특징2"],
  "background": "배경"
}
```
