import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  loadScenarios,
  loadPersonas,
  formatPersonaInfo,
} from "./src/simulator.js";
import {
  generateCustomerResponse,
  generateEvaluation,
  isConnError,
} from "./src/llmClient.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ===== 평가서 저장소 =====
// SUPABASE_URL + SUPABASE_KEY가 있으면 Supabase(영구 저장), 없으면 로컬 파일에 폴백한다.
const TABLE = "evaluations";
const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
    : null;

const EVAL_DIR = path.join(__dirname, "data", "evaluations");
if (!supabase) fs.mkdirSync(EVAL_DIR, { recursive: true });

console.log(`💾 평가 저장소: ${supabase ? "Supabase (영구)" : "로컬 파일 (임시)"}`);

// 저장(생성/갱신)
async function storeRecord(record) {
  if (supabase) {
    const { error } = await supabase
      .from(TABLE)
      .upsert({ id: record.id, data: record });
    if (error) throw new Error(`Supabase 저장 오류: ${error.message}`);
  } else {
    fs.writeFileSync(
      path.join(EVAL_DIR, `${record.id}.json`),
      JSON.stringify(record, null, 2)
    );
  }
}

// 전체 레코드 로드
async function loadAllRecords() {
  if (supabase) {
    const { data, error } = await supabase.from(TABLE).select("data");
    if (error) throw new Error(`Supabase 조회 오류: ${error.message}`);
    return (data || []).map((r) => r.data);
  }
  return fs
    .readdirSync(EVAL_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(EVAL_DIR, f), "utf-8")));
}

// 단건 로드 (없으면 null)
async function loadRecord(id) {
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("data")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Supabase 조회 오류: ${error.message}`);
    return data ? data.data : null;
  }
  const file = path.join(EVAL_DIR, `${path.basename(id)}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : null;
}

// 삭제
async function removeRecord(id) {
  if (supabase) {
    const { error } = await supabase.from(TABLE).delete().eq("id", id);
    if (error) throw new Error(`Supabase 삭제 오류: ${error.message}`);
    return true;
  }
  const file = path.join(EVAL_DIR, `${path.basename(id)}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

// 평가서 텍스트에서 종합 점수를 추출 (여러 형식 대응, 없으면 null)
function parseScore(text) {
  text = text || "";
  const m =
    text.match(/종합\s*점수\s*[:：]?\s*(\d{1,3})/) || // "종합 점수: 72"
    text.match(/최종\s*등급[^\d]*?(\d{1,3})\s*점/) || // "[최종 등급]\n68점 —"
    text.match(/(\d{1,3})\s*점\s*[—–\-]/); // "68점 —"
  return m ? Math.min(100, parseInt(m[1], 10)) : null;
}

// 상담사(지원자) 발화 수 = history에서 첫 유도 프롬프트를 제외한 user 메시지 수
function countTurns(history) {
  return history.slice(1).filter((m) => m.role === "user").length;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// 시나리오 목록
app.get("/api/scenarios", (req, res) => {
  try {
    res.json(loadScenarios());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 페르소나 목록
app.get("/api/personas", (req, res) => {
  try {
    res.json(loadPersonas());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 고객 응답 생성
// body: { scenarioId, personaId, history: [{role, content}, ...] }
app.post("/api/chat", async (req, res) => {
  const { scenarioId, personaId, history } = req.body;

  try {
    const scenario = loadScenarios().find((s) => s.id === scenarioId);
    const persona = loadPersonas().find((p) => p.id === personaId);

    if (!scenario || !persona) {
      return res.status(400).json({ error: "잘못된 시나리오 또는 페르소나입니다." });
    }
    if (!Array.isArray(history)) {
      return res.status(400).json({ error: "history는 배열이어야 합니다." });
    }

    const { reply, ended } = await generateCustomerResponse(
      persona.name,
      formatPersonaInfo(persona),
      scenario.context,
      history
    );

    res.json({ reply, ended });
  } catch (error) {
    res.status(isConnError(error) ? 503 : 500).json({
      error: isConnError(error)
        ? "LLM 서버에 연결할 수 없습니다. 키 또는 Ollama 실행 상태를 확인하세요."
        : error.message,
    });
  }
});

// 진행한 상담을 평가해 평가서 생성 + 저장
// body: { scenarioId, personaId, history }
app.post("/api/evaluate", async (req, res) => {
  const { scenarioId, personaId, history, applicantName } = req.body;

  const scenario = loadScenarios().find((s) => s.id === scenarioId);
  const persona = loadPersonas().find((p) => p.id === personaId);
  if (!scenario || !persona || !Array.isArray(history)) {
    return res.status(400).json({ error: "잘못된 요청입니다." });
  }

  const id = `${Date.now()}`;
  const base = {
    id,
    createdAt: new Date().toISOString(),
    applicantName: (applicantName || "").trim() || "이름 미입력",
    scenarioId,
    scenarioName: scenario.name,
    difficulty: scenario.difficulty,
    personaName: persona.name,
    turns: countTurns(history),
    transcript: history.slice(1).map((m) => ({
      speaker: m.role === "assistant" ? "고객" : "상담사",
      content: m.content,
    })),
  };

  // 1) '생성 중' 상태로 즉시 저장하고 바로 응답한다
  try {
    await storeRecord({ ...base, status: "generating", score: null, evaluation: "" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  res.json({ id, status: "generating" });

  // 2) 백그라운드로 평가서를 생성해 완료/오류 상태로 갱신한다 (응답은 이미 보냄)
  try {
    const evaluation = await generateEvaluation(scenario, persona, history);
    await storeRecord({ ...base, status: "done", score: parseScore(evaluation), evaluation });
  } catch (error) {
    await storeRecord({
      ...base,
      status: "error",
      score: null,
      evaluation: `평가서 생성 중 오류가 발생했습니다.\n${error.message}`,
    }).catch(() => {});
  }
});

// 평가서 삭제
app.delete("/api/evaluations/:id", async (req, res) => {
  try {
    const ok = await removeRecord(req.params.id);
    if (!ok) return res.status(404).json({ error: "평가서를 찾을 수 없습니다." });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 평가서 목록 (메타만, 최신순)
app.get("/api/evaluations", async (req, res) => {
  try {
    const list = (await loadAllRecords())
      .map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        applicantName: r.applicantName || "이름 미입력",
        scenarioName: r.scenarioName,
        difficulty: r.difficulty,
        personaName: r.personaName,
        turns: r.turns,
        score: r.score,
        status: r.status || "done",
      }))
      .sort((a, b) => Number(b.id) - Number(a.id));
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 평가서 상세
app.get("/api/evaluations/:id", async (req, res) => {
  try {
    const r = await loadRecord(req.params.id);
    if (!r) return res.status(404).json({ error: "평가서를 찾을 수 없습니다." });
    res.json(r);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 평가서 텍스트 다운로드 (상담 내용 포함)
app.get("/api/evaluations/:id/download", async (req, res) => {
  let r;
  try {
    r = await loadRecord(req.params.id);
  } catch (e) {
    return res.status(500).send(e.message);
  }
  if (!r) return res.status(404).send("평가서를 찾을 수 없습니다.");

  const diffLabel = { easy: "쉬움", medium: "보통", hard: "어려움" }[r.difficulty] || r.difficulty;
  const convo = (r.transcript || [])
    .map((m) => `[${m.speaker}] ${m.content}`)
    .join("\n");
  const body =
    `채팅상담 모의상담 평가서\n` +
    `================================\n` +
    `지원자: ${r.applicantName || "이름 미입력"}\n` +
    `작성일: ${new Date(r.createdAt).toLocaleString("ko-KR")}\n` +
    `시나리오: ${r.scenarioName} (난이도: ${diffLabel})\n` +
    `고객 유형: ${r.personaName}\n` +
    `대화 턴: ${r.turns}\n` +
    `================================\n\n` +
    `■ 상담 내용\n${convo || "(없음)"}\n\n` +
    `================================\n\n` +
    `■ 평가서\n${r.evaluation}\n`;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="evaluation_${r.id}.txt"`);
  res.send(body);
});

app.listen(PORT, () => {
  console.log(`\n📞 채팅상담 모의상담 시스템 (웹)`);
  console.log(`   → http://localhost:${PORT} 에서 접속하세요\n`);
});
