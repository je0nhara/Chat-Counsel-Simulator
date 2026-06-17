import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

// OPENAI_API_KEY가 있으면 OpenAI(gpt-4o-mini)를 사용하고,
// 없으면 로컬 Ollama(OpenAI 호환 API)로 자동 폴백한다.
// → 배포 시엔 OPENAI_API_KEY만 넣으면 OpenAI로 동작, 로컬 개발은 키 없이 Ollama로 가능.
const USE_OPENAI = !!process.env.OPENAI_API_KEY;

const client = new OpenAI(
  USE_OPENAI
    ? { apiKey: process.env.OPENAI_API_KEY }
    : {
        baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
        apiKey: "ollama", // Ollama는 키를 검사하지 않지만 SDK가 값을 요구함 (더미값)
      }
);

const MODEL = USE_OPENAI
  ? process.env.OPENAI_MODEL || "gpt-4o-mini"
  : process.env.OLLAMA_MODEL || "exaone3.5:7.8b";

// 연결 오류 안내 메시지 (백엔드에 맞게)
function connErrorMessage() {
  return USE_OPENAI
    ? "OpenAI API에 연결할 수 없습니다. OPENAI_API_KEY와 네트워크 상태를 확인하세요."
    : "Ollama 서버에 연결할 수 없습니다. 'ollama serve'로 서버를 실행했는지 확인하세요.";
}

export function isConnError(error) {
  return (
    error.code === "ECONNREFUSED" || /connect|fetch failed|ENOTFOUND/i.test(error.message)
  );
}

// 영어 단어가 2개 이상 연달아 나오면 영어 문장이 섞인 것으로 간주
// (SLA, API, "403 Forbidden" 같은 단일 약어/숫자+단어 코드는 통과시킨다)
export function hasEnglishChatter(text) {
  return /[A-Za-z]+['’]?\s+[A-Za-z]+/.test(text || "");
}

// 모델 응답을 평범한 채팅 텍스트로 정리:
//  - 마크다운 서식(**, *, #) 제거
//  - 맨 앞에 붙는 화자 라벨("고객:", "고객(김화남):", "김화남:") 제거
export function sanitize(text, speakerName = "") {
  let t = (text || "")
    .replace(/\*\*(.*?)\*\*/g, "$1") // **굵게**
    .replace(/\*(.*?)\*/g, "$1") // *기울임*
    .replace(/^#{1,6}\s*/gm, "") // # 머리말
    .replace(/[*#`]/g, "") // 남은 서식 문자
    .replace(/[$%^&@~]{2,}/g, " ") // 특수문자로 가린 비속어($%^ 등) 제거
    .replace(/[ \t]{2,}/g, " ") // 중복 공백 정리
    .trim();
  // 응답 전체를 감싼 따옴표 제거
  t = t.replace(/^["'“”‘’「『《]+\s*|\s*["'“”‘’」』》]+$/g, "").trim();
  // 한국어에 섞인 영어 단어 제거 (ID처럼 밑줄·숫자가 붙은 토큰과 대문자 약어 SLA/API/ID는 보존)
  t = t
    .replace(/(?<![\w'’])[A-Za-z]{2,}(?![\w'’])/g, (m) =>
      /^[A-Z]{2,5}$/.test(m) ? m : ""
    )
    .replace(/\s{2,}/g, " ")
    .trim();
  // 문장 끝에 덧붙은 키워드 꼬리표 제거 (마지막 조각이 종결어미 없이 명사로 끝나면 키워드로 간주)
  t = t
    .replace(/([.!?…])\s*([^.!?…]{1,16})$/, (m, end, tail) =>
      /(다|요|죠|까|네|용|함|음|걸|군|지|야|어|아|니|냐|마|게|라|자)$/.test(tail.trim())
        ? m
        : end
    )
    .trim();
  // 끝에 띄어쓰기 없이 길게 압축된 키워드 덩어리(예: "데일리핏관리자페이지초보자도움필요") 제거
  t = t.replace(/([.!?…])\s*([^.!?…]*[가-힣]{10,}[^.!?…]*)$/, "$1").trim();
  // 끝에 붙은 명사 나열형 키워드 꼬리표 제거 (예: "결제오류 즉시조치필요")
  t = t
    .replace(
      /([.!?…])\s*(?:[가-힣]{2,}\s*){1,3}(?:필요|문제|방법|안내|문의|등록|추가|조치|해결|확인|요청|오류|설정)\s*$/,
      "$1"
    )
    .trim();

  const name = speakerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const who = name
    ? `(?:고객\\s*[\\(（]?\\s*${name}\\s*[\\)）]?|[\\(（]?\\s*${name}\\s*[\\)）]?|고객|상담사)`
    : `(?:고객|상담사)`;
  // 맨 앞 화자 라벨 제거 (예: "김화남: ", "고객(김화남): ")
  t = t.replace(new RegExp(`^\\s*${who}\\s*[:：]\\s*`), "").trim();
  return t;
}

export async function generateCustomerResponse(
  customerName,
  customerPersonality,
  scenarioContext,
  conversationHistory
) {
  const systemPrompt = `당신은 고객센터에 문의하러 온 "고객" ${customerName}입니다. 당신은 상담사가 아니라, 도움을 받으러 온 손님입니다.

[당신의 정체성 — 이 성격과 말투를 끝까지 유지하세요]
${customerPersonality}

[지금 당신이 겪고 있는 상황]
${scenarioContext}

[상담 관계 — 혼동하지 말 것]
당신은 이 솔루션/서비스를 '사용하는' 브랜드의 운영 관리자(고객)입니다. 당신과 대화하는 상담사는 그 솔루션을 '제공하는 회사'의 고객지원 담당자이며, 당신의 브랜드 소속이 아닙니다. 그러니 상담사를 당신 브랜드의 직원처럼 대하거나 당신의 관리자 아이디로 부르지 마세요. 당신이 운영하는 브랜드명은 앞선 문의 내용에 적힌 그대로만 사용하세요.

[연기 규칙 — 반드시 지킬 것]
1. 당신은 '고객'입니다. 절대 상담사처럼 말하지 마세요. "도와드리겠습니다", "확인해 드릴게요", "죄송합니다(응대)", 해결책 제안 같은 상담사 말투는 절대 금지입니다. 당신은 요구하고, 불평하고, 질문하는 쪽입니다.
2. 위 '말투' 설명을 그대로 재현하세요. 존댓말/반말 여부는 물론, 둘이 섞이는 정도까지 설명된 그대로 따르세요(예: 평소엔 존댓말이지만 짜증이 나면 반말이 툭 튀어나오는 식). 짜증·불안·답답함 같은 감정을 말투에 솔직하게 드러내세요.
3. 실제 사람이 채팅하듯 자연스러운 구어체로 말하세요. 교과서 같거나 딱딱하고 기계적인 문장, 정중한 안내문 같은 말투는 피하세요. 가끔 말끝을 흐리거나("...", "음", "아니"), 감탄사를 써도 좋습니다. 별표(*), #, 굵게 같은 마크다운 서식 문자는 절대 쓰지 말고, 메신저에 치듯 평범한 텍스트로만 작성하세요. 욕설이나 *, %, @ 같은 특수문자로 비속어를 가린 표현도 쓰지 마세요. 이건 면접 연습용이니 짜증이 나더라도 선을 넘지 않는 가벼운 수준으로만 표현하세요.
4. 반드시 한국어로만 말하세요. 영어 문장이나 영어 단어, 외국어 표현을 절대 섞지 마세요(예: "you know", "really" 같은 표현 금지). 단 ID, 쿠폰처럼 업계에서 통용되는 일반 용어는 그대로 써도 됩니다. 답변은 짧게, 보통 1~2문장으로만 하세요. 실제 채팅 문의처럼 한 번에 한 가지만 가볍게 말하고, 길게 늘어놓거나 여러 요구를 한꺼번에 쏟아내지 마세요.
5. 위 성격·말투는 '대화를 시작하는 시점의 기본 감정 상태'일 뿐, 끝까지 고정된 게 아닙니다. 실제 사람처럼 직전 상담사 답변에 반응해 감정이 자연스럽게 변해야 합니다. 상담사가 공감해주고 잘 도와주면 점점 누그러지고 협조적이고 고마워하는 쪽으로 풀어지세요. 반대로 형식적이거나 도움이 안 되면 점점 답답함·불만이 커지세요. 처음 감정에 갇혀 매 답변마다 똑같은 감정(예: 계속 불안해하거나 계속 화내기)만 기계적으로 반복하지 마세요.
6. 당신이 AI라거나 역할극 중이라는 메타 발언은 절대 하지 마세요. 항상 ${customerName} 본인으로서 말하세요.
7. 메시지 맨 앞에 자신의 이름이나 "고객:", "${customerName}:" 같은 화자 표시를 붙이지 말고, 말풍선에 들어갈 실제 대사만 작성하세요.
8. 답변 끝에 핵심 키워드, 제목, 해시태그, 요약 같은 꼬리말을 따로 붙이지 말고, 자연스러운 대화 문장으로 끝내세요.
9. 문제가 어느 정도 해결되었고 상담사가 "더 궁금한 점 있으신가요?", "추가로 도와드릴 것 있을까요?"처럼 마무리하려 하면, 억지로 새로운 문제를 만들어내지 말고 고객도 감사 인사와 함께 상담을 자연스럽게 끝내세요(예: "아니요, 다 해결됐어요. 감사합니다!" / "네 덕분에 해결됐네요, 수고하세요"). 단 아직 문제가 해결되지 않았다면 마무리하지 말고 계속 요청하세요.`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
  ];

  try {
    let reply = "";
    // 영어 문장이 섞여 나오면 한 번 재생성한다 (exaone이 간헐적으로 영어를 섞는 것을 보정)
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages,
        temperature: 0.8,
        max_tokens: 115,
        frequency_penalty: 0.4,
        presence_penalty: 0.3,
      });
      const raw = response.choices[0].message.content || "";
      reply = sanitize(raw, customerName);
      // 원본에 영어 문장(2단어 이상)이 있으면 재생성, 1단어 잔여는 sanitize가 이미 제거
      if (!hasEnglishChatter(raw)) break;
    }
    return reply;
  } catch (error) {
    console.error(isConnError(error) ? `❌ ${connErrorMessage()}` : `LLM 오류: ${error.message}`);
    throw error;
  }
}

const DIFFICULTY_LABEL = { easy: "쉬움", medium: "보통", hard: "어려움" };

// 진행한 상담 내역을 바탕으로 상담사(지원자)에 대한 평가서를 작성한다
export async function generateEvaluation(scenario, persona, conversationHistory) {
  // 평가용 대화록 구성: 첫 항목은 고객 유도 프롬프트라 제외, 이후 assistant=고객 / user=상담사
  const transcript = conversationHistory
    .slice(1)
    .map((m) => (m.role === "assistant" ? `고객: ${m.content}` : `상담사: ${m.content}`))
    .join("\n");

  const difficultyLabel = DIFFICULTY_LABEL[scenario.difficulty] || scenario.difficulty;

  const systemPrompt = `당신은 채팅상담 신입 면접을 평가하는 면접관입니다. 아래는 지원자(상담사)가 가상의 고객을 응대한 모의 채팅상담 내역입니다. 지원자의 상담 응대 능력을 평가해 한국어 평가서를 작성하세요.

[시나리오] ${scenario.name} (난이도: ${difficultyLabel})
상황: ${scenario.context}
[고객 유형] ${persona.name} — ${persona.personality}

[매우 중요 — 평가 관점]
- 지원자는 회사의 내부 시스템·절차·메뉴를 전혀 모르는 '신입 지원자'입니다. 고객 메시지만 보고 응대하는 상황입니다.
- 따라서 구체적인 처리 절차나 기능 안내의 '정확성'은 평가하지 마세요. 절차를 몰라서 "확인 후 안내드리겠습니다", "바로 알아봐 드릴게요"처럼 응대한 것은 오히려 바람직한 대응입니다. 절대 감점하지 마세요.
- 평가의 핵심은 '내부 지식 없이도 좋은 응대를 했는가'입니다: 공감·경청, 고객 감정·니즈 파악, 정중한 태도, 적절한 확인·질문(소통), 읽기 쉬운 문장(맞춤법·가독성), 깔끔한 마무리.

[작성 규칙]
- 평가 대상은 '상담사'의 발화입니다. 고객 발화 자체는 평가하지 마세요.
- 시나리오 난이도(${difficultyLabel})는 고객의 감정 강도를 뜻합니다. 까다로운 고객을 침착하게 응대했는지 감안하세요.
- 각 항목은 실제 상담사 발화에서 근거를 찾아 구체적으로 코멘트하세요. 추측으로 칭찬/지적하지 마세요.
- 마크다운 기호(*, #)를 쓰지 말고, 아래 형식 그대로 평범한 텍스트로 작성하세요.

종합 점수: (0~100 사이 숫자) / 100

[항목별 평가] (각 10점 만점)
- 고객 니즈·감정 파악: (점수)/10 - 고객이 무엇을 원하고 어떤 감정인지 정확히 읽었는지
- 공감·경청: (점수)/10 - 고객의 불편·감정에 공감하고 충분히 들어주는 태도를 보였는지
- 응대 태도·정중함: (점수)/10 - 친절하고 정중하며 끝까지 침착하게 응대했는지
- 소통·확인: (점수)/10 - 필요한 정보를 적절히 되묻고, 확인·안내하겠다는 의지를 분명히 보였는지 (절차 자체를 몰라도 됨)
- 맞춤법·오타: (점수)/10 - 오타나 비문 없이 정확하게 작성했는지 (틀린 부분이 있으면 예시를 들 것)
- 가독성·전달력: (점수)/10 - 문장이 읽기 쉽고, 한 번에 너무 길지 않게 적절히 끊어 보냈는지
- 상담 마무리: (점수)/10 - 추가 문의 확인 등으로 깔끔하게 마무리했는지

[잘한 점]
- (구체적으로)

[개선할 점]
- (구체적으로, 단 '내부 절차를 정확히 안내하지 못했다'는 식의 지적은 하지 말 것)

[총평]
(2~3문장)`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `다음 상담 내역을 평가해 주세요.\n\n${transcript}` },
      ],
      temperature: 0.4,
      max_tokens: 900,
    });
    // 평가서는 마크다운 기호만 정리한다 (화자 라벨·꼬리표 로직은 적용하지 않음)
    return (response.choices[0].message.content || "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/[*#`]/g, "")
      .trim();
  } catch (error) {
    console.error(isConnError(error) ? `❌ ${connErrorMessage()}` : `평가 오류: ${error.message}`);
    throw error;
  }
}
