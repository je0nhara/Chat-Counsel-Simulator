import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateCustomerResponse } from "./llmClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadScenarios() {
  const scenarioPath = path.join(__dirname, "../config/scenarios.json");
  const data = fs.readFileSync(scenarioPath, "utf-8");
  return JSON.parse(data).scenarios;
}

export function loadPersonas() {
  const personaPath = path.join(__dirname, "../config/personas.json");
  const data = fs.readFileSync(personaPath, "utf-8");
  return JSON.parse(data).personas;
}

export function displayScenarios(scenarios) {
  console.log("\n=== 시나리오 선택 ===\n");
  scenarios.forEach((scenario, index) => {
    const difficulty = {
      easy: "🟢 쉬움",
      medium: "🟡 중간",
      hard: "🔴 어려움",
    }[scenario.difficulty];

    console.log(`${index + 1}. ${scenario.name} ${difficulty}`);
    console.log(`   ${scenario.description}\n`);
  });
}

export function displayPersonas(personas) {
  console.log("\n=== 고객 페르소나 선택 ===\n");
  personas.forEach((persona, index) => {
    console.log(`${index + 1}. ${persona.name} (${persona.age}세)`);
    console.log(`   성격: ${persona.personality}`);
    console.log(`   특징: ${persona.traits.join(", ")}\n`);
  });
}

export function formatPersonaInfo(persona) {
  return `
이름: ${persona.name}
나이: ${persona.age}세
성격: ${persona.personality}
말투: ${persona.tone}
특징: ${persona.traits.join(", ")}
배경: ${persona.background}`;
}

export async function startConsultation(scenario, persona) {
  console.log("\n" + "=".repeat(50));
  console.log(`📞 상담 시작: ${scenario.name}`);
  console.log("=".repeat(50));
  console.log(`\n고객: ${persona.name} (${persona.age}세)`);
  console.log(`성격: ${persona.personality}`);
  console.log(`\n상황: ${scenario.context}\n`);
  console.log("=".repeat(50));
  console.log("💬 대화를 시작하세요. (종료: 'quit' 입력)\n");

  const conversationHistory = [];

  // 초기 고객 인사 생성
  const initialPrompt = `당신은 위 서비스를 이용하는 브랜드의 운영 관리자입니다. 방금 채팅 상담 챗봇에 브랜드명과 관리자 아이디를 입력해 상담을 신청했고, 지금 담당 상담사에게 문의 내용을 처음 작성하는 순간입니다. 상담사의 인사를 기다리지 말고, 위 상황과 성격에 맞게 겪고 있는 문제를 문의 내용으로 직접 남기세요.`;

  conversationHistory.push({
    role: "user",
    content: initialPrompt,
  });

  try {
    console.log("(고객 응답 생성 중...)\n");
    const { reply: initialResponse } = await generateCustomerResponse(
      persona.name,
      formatPersonaInfo(persona),
      scenario.context,
      conversationHistory
    );

    console.log(`고객(${persona.name}): ${initialResponse}\n`);

    conversationHistory.push({
      role: "assistant",
      content: initialResponse,
    });

    // 대화 루프
    let messageCount = 0;
    const readline = await import("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      const askQuestion = () => {
        rl.question("상담사: ", async (userInput) => {
          if (userInput.toLowerCase() === "quit") {
            console.log("\n" + "=".repeat(50));
            console.log("📊 상담 종료");
            console.log("=".repeat(50));
            console.log(`\n총 대화 턴: ${messageCount}`);
            console.log("상담을 종료했습니다.\n");
            rl.close();
            resolve();
            return;
          }

          messageCount++;
          conversationHistory.push({
            role: "user",
            content: userInput,
          });

          try {
            console.log("(응답 생성 중...)\n");
            const { reply: customerResponse } = await generateCustomerResponse(
              persona.name,
              formatPersonaInfo(persona),
              scenario.context,
              conversationHistory
            );

            console.log(`고객(${persona.name}): ${customerResponse}\n`);

            conversationHistory.push({
              role: "assistant",
              content: customerResponse,
            });

            askQuestion();
          } catch (error) {
            console.error("응답 생성 오류:", error.message);
            console.log("다시 시도해주세요.\n");
            askQuestion();
          }
        });
      };

      askQuestion();
    });
  } catch (error) {
    console.error("상담 시작 오류:", error.message);
    throw error;
  }
}
