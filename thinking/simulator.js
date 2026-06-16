import fs from "fs";
import path from "path";
import { generateCustomerResponse } from "./openaiClient.js";

const __dirname = new URL(".", import.meta.url).pathname;

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
  const initialPrompt = `상담사가 "안녕하세요, 무엇을 도와드릴까요?"라고 인사했습니다. 당신은 위의 상황과 성격에 맞게 자신의 문제를 간단히 설명하며 인사에 응답하세요.`;

  conversationHistory.push({
    role: "user",
    content: initialPrompt,
  });

  try {
    const initialResponse = await generateCustomerResponse(
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
            const customerResponse = await generateCustomerResponse(
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
