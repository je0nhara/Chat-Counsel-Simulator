import readline from "readline";
import {
  loadScenarios,
  loadPersonas,
  displayScenarios,
  displayPersonas,
  startConsultation,
} from "./simulator.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion(query) {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

async function main() {
  console.log("\n╔════════════════════════════════════════════╗");
  console.log("║   📞 채팅상담 모의상담 시스템 (Interview) ║");
  console.log("╚════════════════════════════════════════════╝\n");

  try {
    // 시나리오 로드
    const scenarios = loadScenarios();
    const personas = loadPersonas();

    // 시나리오 선택
    displayScenarios(scenarios);
    const scenarioChoice = await askQuestion("시나리오 번호 선택 (1-5): ");
    const scenarioIndex = parseInt(scenarioChoice) - 1;

    if (scenarioIndex < 0 || scenarioIndex >= scenarios.length) {
      console.log("❌ 잘못된 선택입니다.");
      rl.close();
      return;
    }

    const selectedScenario = scenarios[scenarioIndex];

    // 페르소나 선택
    displayPersonas(personas);
    const personaChoice = await askQuestion("고객 페르소나 번호 선택 (1-4): ");
    const personaIndex = parseInt(personaChoice) - 1;

    if (personaIndex < 0 || personaIndex >= personas.length) {
      console.log("❌ 잘못된 선택입니다.");
      rl.close();
      return;
    }

    const selectedPersona = personas[personaIndex];

    // CLI readline 종료 (상담 시작 전)
    rl.close();

    // 상담 시작
    await startConsultation(selectedScenario, selectedPersona);

    process.exit(0);
  } catch (error) {
    console.error("❌ 오류 발생:", error.message);
    rl.close();
    process.exit(1);
  }
}

main();
