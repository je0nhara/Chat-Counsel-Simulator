import OpenAI from "openai";
import https from "https";
import dotenv from "dotenv";

dotenv.config();

// keep-alive 연결 재사용 중 끊기는 "Premature close"를 피하려고 매 요청 새 연결을 쓴다
const httpAgent = new https.Agent({ keepAlive: false });

// LLM 백엔드 선택 (우선순위):
//  1) LLM_BASE_URL + LLM_API_KEY  → 임의의 OpenAI 호환 제공자 (Gemini, Groq 등 무료 LLM)
//  2) OPENAI_API_KEY              → OpenAI
//  3) (없음)                       → 로컬 Ollama 폴백
const USE_GENERIC = !!(process.env.LLM_BASE_URL && process.env.LLM_API_KEY);
const USE_OPENAI = !USE_GENERIC && !!process.env.OPENAI_API_KEY;

const client = new OpenAI(
  USE_GENERIC
    ? { baseURL: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, maxRetries: 3, httpAgent }
    : USE_OPENAI
    ? { apiKey: process.env.OPENAI_API_KEY, maxRetries: 3, httpAgent }
    : {
        baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
        apiKey: "ollama", // Ollama는 키를 검사하지 않지만 SDK가 값을 요구함 (더미값)
      }
);

const MODEL = USE_GENERIC
  ? process.env.LLM_MODEL || "gemini-2.0-flash"
  : USE_OPENAI
  ? process.env.OPENAI_MODEL || "gpt-4o-mini"
  : process.env.OLLAMA_MODEL || "exaone3.5:7.8b";

// 연결 오류 안내 메시지 (백엔드에 맞게)
function connErrorMessage() {
  return USE_GENERIC || USE_OPENAI
    ? "LLM API에 연결할 수 없습니다. API 키와 네트워크 상태를 확인하세요."
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

// 고객 발화가 상담을 끝내는 작별/마무리인지 휴리스틱 판정
// (모델이 [상담종료] 마커를 빠뜨리는 경우의 폴백)
export function looksLikeClosing(text) {
  const t = text || "";
  const farewell =
    /(다\s*해결|해결\s*됐|해결\s*되었|해결\s*됐네|잘\s*해결|덕분에|수고하세요|좋은\s*하루|그럼\s*이만|이만\s*(마치|줄)|마무리하|괜찮(아요|습니다)\.?$)/.test(
      t
    );
  const stillAsking =
    /[?？]|언제|어떻게|얼마|몇\s|될까요|되나요|있을까요|할까요|확인해|확인\s*좀|알려\s*주|가능할까|부탁|해\s*주세요/.test(
      t
    );
  return farewell && !stillAsking;
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
※ 가장 중요: 상대(상담사)를 절대 "고객님"이라고 부르지 마세요. '고객'은 바로 당신입니다. 상담사를 부를 일이 있으면 "상담사님"이라고 하세요. 상담사가 친근하게 말하거나 인사해도 그 말투를 따라 하지 말고, 끝까지 도움을 받는 '고객'의 입장과 말투를 유지하세요.

[연기 규칙 — 반드시 지킬 것]
1. 당신은 '고객'입니다. 절대 상담사처럼 말하지 마세요. "도와드리겠습니다", "확인해 드릴게요", "죄송합니다(응대)", 해결책 제안 같은 상담사 말투는 절대 금지입니다. 당신은 요구하고, 불평하고, 질문하는 쪽입니다.
2. 위 '말투' 설명을 그대로 재현하세요. 존댓말/반말 여부는 물론, 둘이 섞이는 정도까지 설명된 그대로 따르세요(예: 평소엔 존댓말이지만 짜증이 나면 반말이 툭 튀어나오는 식). 짜증·불안·답답함 같은 감정을 말투에 솔직하게 드러내세요.
3. 실제 사람이 채팅하듯 자연스러운 구어체로 말하세요. 교과서 같거나 딱딱하고 기계적인 문장, 정중한 안내문 같은 말투는 피하세요. 가끔 말끝을 흐리거나("...", "음", "아니"), 감탄사를 써도 좋습니다. 별표(*), #, 굵게 같은 마크다운 서식 문자는 절대 쓰지 말고, 메신저에 치듯 평범한 텍스트로만 작성하세요. 욕설이나 *, %, @ 같은 특수문자로 비속어를 가린 표현도 쓰지 마세요. 이건 면접 연습용이니 짜증이 나더라도 선을 넘지 않는 가벼운 수준으로만 표현하세요.
4. 반드시 한국어로만 말하세요. 영어 문장이나 영어 단어, 외국어 표현을 절대 섞지 마세요(예: "you know", "really" 같은 표현 금지). 단 ID, 쿠폰처럼 업계에서 통용되는 일반 용어는 그대로 써도 됩니다. 답변은 짧게, 보통 1~2문장으로만 하세요. 실제 채팅 문의처럼 한 번에 한 가지만 가볍게 말하고, 길게 늘어놓거나 여러 요구를 한꺼번에 쏟아내지 마세요.
5. 위 성격·말투는 '대화를 시작하는 시점의 기본 감정 상태'일 뿐, 끝까지 고정된 게 아닙니다. 실제 사람처럼 직전 상담사 답변에 반응해 감정이 자연스럽게 변해야 합니다. 상담사가 공감해주고 잘 도와주면 점점 누그러지고 협조적이고 고마워하는 쪽으로 풀어지세요. 반대로 형식적이거나 도움이 안 되면 점점 답답함·불만이 커지세요. 처음 감정에 갇혀 매 답변마다 똑같은 감정(예: 계속 불안해하거나 계속 화내기)만 기계적으로 반복하지 마세요.
6. 당신이 AI라거나 역할극 중이라는 메타 발언은 절대 하지 마세요. 항상 ${customerName} 본인으로서 말하세요.
7. 메시지 맨 앞에 자신의 이름이나 "고객:", "${customerName}:" 같은 화자 표시를 붙이지 말고, 말풍선에 들어갈 실제 대사만 작성하세요.
8. 답변 끝에 핵심 키워드, 제목, 해시태그, 요약 같은 꼬리말을 따로 붙이지 말고, 자연스러운 대화 문장으로 끝내세요.
9. 문제가 어느 정도 해결되었고 상담사가 "더 궁금한 점 있으신가요?", "추가로 도와드릴 것 있을까요?"처럼 마무리하려 하면, 억지로 새로운 문제를 만들어내지 말고 고객도 감사 인사와 함께 상담을 자연스럽게 끝내세요(예: "아니요, 다 해결됐어요. 감사합니다!" / "네 덕분에 해결됐네요, 수고하세요"). 이때도 당신은 고객이므로, 상담사를 따라 "고객님"이라고 부르거나 상담사 같은 마무리 말투를 쓰지 마세요. 단 아직 문제가 해결되지 않았다면 마무리하지 말고 계속 요청하세요.
10. 문제가 해결되어 작별 인사까지 마치고 더 이상 묻거나 요청할 것이 없어 상담을 완전히 끝낼 때에만, 그 마지막 메시지의 맨 끝에 정확히 [상담종료] 라고 덧붙이세요. 아직 궁금하거나 요청할 것이 남아 있으면 절대 붙이지 마세요. (이 표시는 시스템이 상담 종료를 인식하는 신호입니다.)`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
  ];

  try {
    let reply = "";
    let ended = false;
    // 영어 문장이 섞여 나오면 한 번 재생성한다 (exaone이 간헐적으로 영어를 섞는 것을 보정)
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages,
        temperature: 0.8,
        max_tokens: 115,
      });
      const raw = response.choices[0].message.content || "";
      // 고객이 상담을 끝내는 신호 [상담종료] 감지 후 제거
      ended = /\[\s*상담\s*종료\s*\]/.test(raw);
      reply = sanitize(raw.replace(/\[\s*상담\s*종료\s*\]/g, ""), customerName);
      // 원본에 영어 문장(2단어 이상)이 있으면 재생성, 1단어 잔여는 sanitize가 이미 제거
      if (!hasEnglishChatter(raw)) break;
    }
    // 마커를 놓친 경우라도 작별 발화면 종료로 처리 (폴백)
    if (!ended && looksLikeClosing(reply)) ended = true;
    return { reply, ended };
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

  const systemPrompt = `당신은 '블룸에이아이 CX 솔루션운영팀' 채용 면접관입니다. 아래 모의 채팅상담을 회사 평가 지침(SERVQUAL 5차원 기반)에 따라 평가해 한국어 평가서를 작성하세요.

[이 모의상담의 특성 — 매우 중요]
- 이 모의상담은 고객에게 어떤 구체적 상황도 미리 주지 않고, 지원자가 가상의 상황을 상상해 응대하는 시뮬레이션입니다.
- 따라서 지원자가 확인·안내한 내용(처리 상태·절차·기간 등)은 가상으로 지어낸 것이어도 됩니다. 사실 여부나 정확성을 따지지 말고, 그 안내가 상황에 자연스럽고 고객을 납득시켰는지를 보세요.
- 'OO상품', 'OO', '○○', 'XX' 같은 빈칸 표현은 가상 상황을 안내하기 위한 장치이므로 오류로 보지 마세요(정상적인 안내로 인정).
- 제품·서비스·내부 절차를 모르는 것은 감점 사유가 아닙니다. 모르는 상황에서 어떻게 사고하고 응대하는가를 봅니다.
- 무엇보다, 지원자의 응대를 듣고 모의 고객이 납득하여 상담을 마무리했다면 상담이 잘 흘러간 것입니다. 상담 종결의 자연스러움을 높이 평가하세요.

[시나리오] ${scenario.name} (난이도: ${difficultyLabel})
상황: ${scenario.context}
[고객 유형] ${persona.name} — ${persona.personality}

[난이도 반영]
- 난이도(${difficultyLabel})는 고객의 까다로움/감정 강도를 뜻합니다. 난이도가 높을수록(어려움) 다루기 힘든 고객을 상대한 것이므로, 그런 상황에서도 침착하고 안정적으로 응대했다면 더 후하게 평가하세요. '쉬움'에서 무난히 한 것보다 '어려움'에서 잘 풀어낸 것을 더 높이 봅니다.

[평가 항목 — SERVQUAL 5차원, 합 100점]
1. 공감성(Empathy) / 고객 니즈·감정 발견 (25점): 고객이 말한 현상 너머의 진짜 니즈와 감정을 읽고 공감하며 정확히 파악했는가.
2. 신뢰성(Reliability) / 문제 분석·해결 (25점): 문제를 정확히 정리하고 믿음직하고 일관된 해결 방향을 제시해 고객이 신뢰할 수 있게 했는가.
3. 응답성(Responsiveness) / 신속한 처리 (15점): 불필요하게 늘어지지 않고 적시에 효율적으로 핵심을 파악·대응했는가.
4. 확신성(Assurance) / 안내의 전문성·확신 (15점): 확신 있고 전문적인 어조로 안내해 고객이 안심하고 신뢰감을 느끼게 했는가. (정확한 제품 지식이 아니라 확신 있게 안내하는 태도를 봄)
5. 유형성(Tangibles) / 문장 구성·가독성·표현 품질 (20점): 문장을 가독성 좋게 적절히 끊고 문단을 나눴는가, 단어·문장 구성이 정돈되고 고급스러운가, 오타·비문 없이 전문적으로 보이는가.

[작성 규칙]
- 평가 대상은 '상담사(지원자)'의 발화입니다. 고객 발화는 평가 대상이 아닙니다.
- 반드시 실제 발화를 근거로 평가하고, 근거 없는 추측 평가는 하지 마세요.
- 정확한 안내·문제 파악을 위한 '목적 있는' 확인 질문은 가점 요소이며 절대 약점으로 지적하지 마세요. 같은 정보를 불필요하게 반복하거나 목적 없이 과하게 확인을 요구해 고객을 지치게 한 경우에만 약점입니다.
- 점수는 후하게: 고객을 이해하려 하고 안정적으로 응대해 상담을 잘 마무리했다면 기본적으로 높은 점수를 주고, 명확히 응대 품질을 떨어뜨린 문제가 있을 때만 감점하세요.
- 마크다운 기호(*, #) 금지. 각 항목 점수는 0 이상 만점 이하 정수, "항목명: 획득/만점 - 근거(실제 발화 인용)" 형식.
- 종합 점수 = 5개 항목 합(최대 100)에서 감점을 뺀 값(0 미만이면 0). 채용 등급은 종합 점수 구간과 일치.

종합 점수: (0~100 정수) / 100

[SERVQUAL 5차원 평가]
1. 공감성(Empathy) - 고객 니즈·감정 발견: (획득)/25 - 근거
2. 신뢰성(Reliability) - 문제 분석·해결: (획득)/25 - 근거
3. 응답성(Responsiveness) - 신속한 처리: (획득)/15 - 근거
4. 확신성(Assurance) - 안내의 전문성·확신: (획득)/15 - 근거
5. 유형성(Tangibles) - 문장 구성·가독성·표현: (획득)/20 - 근거

[감점] (해당 시 명시, 없으면 "없음")
- 경미(-3~-5) / 중간(-5~-10) / 치명적(-15: 확인 없는 단정, 허위 안내, 고객 책임 전가, 무례한 응대)
- 단, 가상으로 지어낸 안내·OO 빈칸 표현·목적 있는 확인 질문은 감점하지 마세요.

[채용 적합도]
(종합 점수)점 — A(90~100, 즉시 채용) / B(80~89, 채용 권장) / C(70~79, 조건부 채용) / D(60~69, 보류) / E(59 이하, 부적합)

[강점]
- 근거 발화와 함께 구체적으로

[약점·리스크]
- 실제로 응대 품질을 '명확히' 떨어뜨린 문제만 적습니다. 없으면 다른 말 없이 "특별한 약점 없음"이라고만 적으세요. 다음은 약점이 아니니 절대 적지 마세요: 가상으로 지어낸 안내, OO·XX 같은 빈칸 표현, 목적 있는 확인 질문, 제품·절차를 모르는 것, 상담 중 문제를 완전히 해결하지 못한 것, "더 ~했으면 좋았을 것"류 사소한 아쉬움.

[종합 의견]
(2~3문장, SERVQUAL 차원 중 강한 차원과 보완점, 상담 종결의 자연스러움을 중심으로)`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `다음 상담 내역을 평가해 주세요.\n\n${transcript}` },
  ];
  try {
    // 재시도: 긴 평가서 생성 중 연결이 끊기는("Premature close") 문제를 보정
    let raw = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await client.chat.completions.create({
          model: MODEL,
          messages,
          temperature: 0.3,
          max_tokens: 1300,
        });
        raw = response.choices[0].message.content || "";
        if (raw.trim()) break;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    // 평가서는 마크다운 기호만 정리한다 (화자 라벨·꼬리표 로직은 적용하지 않음)
    return raw
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/[*#`]/g, "")
      .trim();
  } catch (error) {
    console.error(isConnError(error) ? `❌ ${connErrorMessage()}` : `평가 오류: ${error.message}`);
    throw error;
  }
}
