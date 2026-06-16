import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateCustomerResponse(
  customerName,
  customerPersonality,
  scenarioContext,
  conversationHistory
) {
  const systemPrompt = `당신은 ${customerName}입니다.

성격 및 특징:
${customerPersonality}

상황 및 배경:
${scenarioContext}

위의 설정을 바탕으로 자연스럽게 한국어로 고객 역할을 해주세요. 
다음 규칙을 따르세요:
1. 한국어로만 답변하세요
2. 캐릭터 설정을 벗어나지 마세요
3. 과도하게 길지 않게 1-2문장으로 답변하세요
4. 자연스럽고 현실감있게 반응하세요
5. 상담사의 말에 적절하게 반응하세요`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        ...conversationHistory,
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error("OpenAI API 오류:", error.message);
    throw error;
  }
}
