// ===== 상태 =====
let scenarios = [];
let personas = [];
let selectedScenario = null;
let selectedPersona = null;
let history = []; // [{ role: "user"|"assistant", content }]
let turnCount = 0;
let busy = false;
let currentBrand = null;

// 챗봇 상담 신청 단계에서 수집되는 (가상) 브랜드 정보 풀
const BRANDS = [
  { name: "무드러버", adminId: "moodlover_adm" },
  { name: "데일리핏", adminId: "dailyfit_op" },
  { name: "코지홈리빙", adminId: "cozyhome_admin" },
  { name: "어반스텝", adminId: "urbanstep_mgr" },
  { name: "글로우베이스", adminId: "glowbase_adm" },
];
function pickBrand() {
  return BRANDS[Math.floor(Math.random() * BRANDS.length)];
}

// ===== DOM =====
const $ = (id) => document.getElementById(id);
const scenarioList = $("scenario-list");
const personaList = $("persona-list");
const startBtn = $("start-btn");
const setupScreen = $("setup");
const chatScreen = $("chat");
const messagesEl = $("messages");
const chatForm = $("chat-form");
const chatText = $("chat-text");
const sendBtn = $("send-btn");
const endBtn = $("end-btn");
const summaryModal = $("summary");
const recordsScreen = $("records");

let currentEvalId = null; // 평가서 모달에 현재 표시 중인 평가 id (다운로드용)

const DIFFICULTY = {
  easy: { label: "쉬움", cls: "easy" },
  medium: { label: "중간", cls: "medium" },
  hard: { label: "어려움", cls: "hard" },
};

// ===== 초기 로드 =====
async function init() {
  try {
    [scenarios, personas] = await Promise.all([
      fetch("/api/scenarios").then((r) => r.json()),
      fetch("/api/personas").then((r) => r.json()),
    ]);
    renderScenarios();
    renderPersonas();
  } catch (e) {
    alert("데이터를 불러오지 못했습니다. 서버가 실행 중인지 확인하세요.");
  }
}

function renderScenarios() {
  scenarioList.innerHTML = "";
  scenarios.forEach((s) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-title">${s.name}</div>
      <div class="card-desc">${s.description}</div>`;
    card.onclick = () => {
      selectedScenario = s;
      highlight(scenarioList, card);
      updateStartBtn();
    };
    scenarioList.appendChild(card);
  });
}

function renderPersonas() {
  personaList.innerHTML = "";
  personas.forEach((p) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-title">${p.name} <span class="card-desc">(${p.age}세)</span></div>
      <div class="card-desc">${p.personality} · ${p.traits.join(", ")}</div>`;
    card.onclick = () => {
      selectedPersona = p;
      highlight(personaList, card);
      updateStartBtn();
    };
    personaList.appendChild(card);
  });
}

function highlight(container, card) {
  [...container.children].forEach((c) => c.classList.remove("selected"));
  card.classList.add("selected");
}

function updateStartBtn() {
  startBtn.disabled = !(selectedScenario && selectedPersona);
}

// ===== 상담 시작 =====
startBtn.onclick = async () => {
  history = [];
  turnCount = 0;
  messagesEl.innerHTML = "";
  currentBrand = pickBrand();

  $("chat-title").textContent = `📞 ${selectedScenario.name}`;
  $("chat-sub").textContent = `고객: ${selectedPersona.name} (${selectedPersona.age}세) · ${selectedPersona.personality}`;

  setupScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");

  // 챗봇 상담 신청 접수 안내 (회사 프로세스: 챗봇이 브랜드명·관리자ID 수집 후 상담 인입)
  addSystemNote(
    `💬 채팅 상담이 연결되었습니다.<br>` +
      `<b>브랜드:</b> ${currentBrand.name} &nbsp;·&nbsp; <b>관리자 ID:</b> ${currentBrand.adminId}<br>` +
      `담당자가 문의 내용을 작성하면 확인 작업을 시작합니다.`
  );

  // 초기 고객 문의 — 화면엔 표시하지 않는 프롬프트를 history에 넣고 응답을 받는다
  const initialPrompt = `당신은 위 서비스를 이용하는 브랜드 '${currentBrand.name}'의 운영 관리자입니다. 방금 채팅 상담 챗봇에 브랜드명과 관리자 아이디(${currentBrand.adminId})를 입력해 상담을 신청했고, 지금 담당 상담사에게 문의 내용을 처음 작성하는 순간입니다. 상담사의 인사를 기다리지 말고, 위 상황과 성격에 맞게 겪고 있는 문제를 문의 내용으로 직접 남기세요.`;
  history.push({ role: "user", content: initialPrompt });
  await requestCustomerReply();
};

// ===== 입력창: 자동 높이 + Enter/Shift+Enter =====
function autoResize() {
  chatText.style.height = "auto";
  chatText.style.height = Math.min(chatText.scrollHeight, 140) + "px";
}
chatText.addEventListener("input", autoResize);

chatText.addEventListener("keydown", (e) => {
  // Enter = 전송, Shift+Enter = 줄바꿈 (한글 조합 중인 IME 입력은 무시)
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

// ===== 메시지 전송 =====
chatForm.onsubmit = async (e) => {
  e.preventDefault();
  const text = chatText.value.trim();
  if (!text || busy) return;

  addMessage("counselor", text, "상담사");
  history.push({ role: "user", content: text });
  turnCount++;
  chatText.value = "";
  autoResize();

  await requestCustomerReply();
};

async function requestCustomerReply() {
  setBusy(true);
  const typing = showTyping();
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenarioId: selectedScenario.id,
        personaId: selectedPersona.id,
        history,
      }),
    });
    const data = await res.json();
    typing.remove();

    if (!res.ok) {
      addMessage("customer", `⚠️ ${data.error || "응답 생성에 실패했습니다."}`, "시스템");
      return;
    }

    addMessage("customer", data.reply, `고객(${selectedPersona.name})`);
    history.push({ role: "assistant", content: data.reply });
  } catch (e) {
    typing.remove();
    addMessage("customer", "⚠️ 서버와 통신할 수 없습니다.", "시스템");
  } finally {
    setBusy(false);
    chatText.focus();
  }
}

// ===== UI 헬퍼 =====
function addMessage(role, text, name) {
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.alignItems = role === "counselor" ? "flex-end" : "flex-start";

  const nameEl = document.createElement("div");
  nameEl.className = "msg-name" + (role === "counselor" ? " right" : "");
  nameEl.textContent = name;

  const msg = document.createElement("div");
  msg.className = `msg ${role}`;
  msg.textContent = text;

  wrap.appendChild(nameEl);
  wrap.appendChild(msg);
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addSystemNote(html) {
  const el = document.createElement("div");
  el.className = "sys-note";
  el.innerHTML = html;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showTyping() {
  const el = document.createElement("div");
  el.className = "typing";
  el.innerHTML = `${selectedPersona.name} 입력 중<span>.</span><span>.</span><span>.</span>`;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function setBusy(state) {
  busy = state;
  sendBtn.disabled = state;
  chatText.disabled = state;
}

// ===== 종료 / 재시작 =====
// 평가서 모달 렌더 (context: "result"=상담 직후 / "record"=기록 열람)
function showEvalModal(data, context) {
  currentEvalId = data.id || null;
  const meta = $("eval-meta");
  const body = $("eval-body");
  const d = DIFFICULTY[data.difficulty] || { label: data.difficulty, cls: "" };

  let html =
    `<span>${data.scenarioName}</span>` +
    `<span class="badge ${d.cls}">${d.label}</span>` +
    `<span class="turns">· 대화 ${data.turns}턴</span>`;
  if (data.createdAt)
    html += `<span class="turns">· ${new Date(data.createdAt).toLocaleString("ko-KR")}</span>`;
  if (data.score != null) html += `<span class="eval-score">${data.score}점</span>`;
  meta.innerHTML = html;

  body.className = "eval-body";
  body.textContent = data.evaluation;

  $("eval-download").style.display = data.id ? "" : "none";
  const primary = $("eval-primary");
  if (context === "record") {
    primary.textContent = "닫기";
    primary.onclick = () => summaryModal.classList.add("hidden");
  } else {
    primary.textContent = "새 상담 시작";
    primary.onclick = goToSetup;
  }
  summaryModal.classList.remove("hidden");
}

endBtn.onclick = async () => {
  const meta = $("eval-meta");
  const body = $("eval-body");
  summaryModal.classList.remove("hidden");
  $("eval-download").style.display = "none";
  const primary = $("eval-primary");
  primary.textContent = "새 상담 시작";
  primary.onclick = goToSetup;

  // 상담사 발화가 한 번도 없으면 평가할 내용이 없음
  if (turnCount === 0) {
    meta.innerHTML = "";
    body.className = "eval-body";
    body.innerHTML =
      "<p class='eval-empty'>상담을 진행한 뒤에 평가서를 받을 수 있어요.<br>고객에게 한 번 이상 응대해 주세요.</p>";
    return;
  }

  const d = DIFFICULTY[selectedScenario.difficulty] || { label: selectedScenario.difficulty, cls: "" };
  meta.innerHTML =
    `<span>${selectedScenario.name}</span>` +
    `<span class="badge ${d.cls}">${d.label}</span>` +
    `<span class="turns">· 대화 ${turnCount}턴</span>`;
  body.className = "eval-body";
  body.innerHTML = "<div class='eval-loading'>평가서를 작성하는 중입니다… (수 초 소요)</div>";

  try {
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenarioId: selectedScenario.id,
        personaId: selectedPersona.id,
        history,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      body.innerHTML = `<p class='eval-empty'>⚠️ ${data.error || "평가서 생성에 실패했습니다."}</p>`;
      return;
    }
    showEvalModal(
      {
        id: data.id,
        scenarioName: selectedScenario.name,
        difficulty: data.difficulty,
        turns: turnCount,
        score: data.score,
        evaluation: data.evaluation,
      },
      "result"
    );
  } catch (e) {
    body.innerHTML = "<p class='eval-empty'>⚠️ 서버와 통신할 수 없습니다.</p>";
  }
};

// 평가서 다운로드
$("eval-download").onclick = () => {
  if (currentEvalId) window.location.href = `/api/evaluations/${currentEvalId}/download`;
};

// ===== 평가 기록 =====
$("open-records").onclick = showRecords;
$("records-back").onclick = goToSetup;

async function showRecords() {
  setupScreen.classList.add("hidden");
  recordsScreen.classList.remove("hidden");
  const list = $("records-list");
  list.innerHTML = "<p class='records-empty'>불러오는 중…</p>";
  try {
    const records = await (await fetch("/api/evaluations")).json();
    if (!records.length) {
      list.innerHTML = "<p class='records-empty'>아직 저장된 평가가 없어요.<br>상담을 마치고 평가를 받아보세요.</p>";
      return;
    }
    list.innerHTML = "";
    records.forEach((r) => {
      const d = DIFFICULTY[r.difficulty] || { label: r.difficulty, cls: "" };
      const item = document.createElement("div");
      item.className = "record-item";
      item.innerHTML =
        `<div class="record-score">${r.score ?? "-"}<small>/100</small></div>` +
        `<div class="record-info">` +
        `<div class="record-name">${r.scenarioName} <span class="badge ${d.cls}">${d.label}</span></div>` +
        `<div class="record-sub">${r.personaName} · 대화 ${r.turns}턴 · ${new Date(r.createdAt).toLocaleString("ko-KR")}</div>` +
        `</div>`;
      item.onclick = () => openRecordDetail(r.id);
      list.appendChild(item);
    });
  } catch (e) {
    list.innerHTML = "<p class='records-empty'>목록을 불러오지 못했어요.</p>";
  }
}

async function openRecordDetail(id) {
  try {
    const r = await (await fetch(`/api/evaluations/${id}`)).json();
    showEvalModal(r, "record");
  } catch (e) {
    alert("평가서를 불러오지 못했습니다.");
  }
}

function goToSetup() {
  summaryModal.classList.add("hidden");
  chatScreen.classList.add("hidden");
  recordsScreen.classList.add("hidden");
  setupScreen.classList.remove("hidden");
  selectedScenario = null;
  selectedPersona = null;
  renderScenarios();
  renderPersonas();
  updateStartBtn();
}

// 채팅 중 시나리오 선택 화면으로 돌아가기
$("back-btn").onclick = () => {
  if (turnCount > 0 && !confirm("진행 중인 상담을 종료하고 시나리오 선택으로 돌아갈까요?")) {
    return;
  }
  goToSetup();
};

init();
