// ===== 상태 =====
let scenarios = [];
let personas = [];
let applicantName = "";
let selectedScenario = null;
let selectedPersona = null;
let history = []; // [{ role: "user"|"assistant", content }]
let turnCount = 0;
let busy = false;
let currentBrand = null;
let currentEvalId = null; // 평가서 모달(기록 열람)에서 다운로드용

// 챗봇 상담 신청 단계에서 수집되는 (가상) 브랜드 정보 풀
const BRANDS = [
  { name: "무드러버", adminId: "moodlover_adm" },
  { name: "데일리핏", adminId: "dailyfit_op" },
  { name: "코지홈리빙", adminId: "cozyhome_admin" },
  { name: "어반스텝", adminId: "urbanstep_mgr" },
  { name: "글로우베이스", adminId: "glowbase_adm" },
];
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ===== DOM =====
const $ = (id) => document.getElementById(id);
const setupScreen = $("setup");
const chatScreen = $("chat");
const recordsScreen = $("records");
const nameInput = $("applicant-name");
const startBtn = $("start-btn");
const messagesEl = $("messages");
const chatForm = $("chat-form");
const chatText = $("chat-text");
const sendBtn = $("send-btn");
const endBtn = $("end-btn");
const endedModal = $("ended");
const summaryModal = $("summary");
const gateModal = $("gate");

const RECORDS_PASSWORD = "2187";
let recordsPollTimer = null;

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
    renderIntros();
  } catch (e) {
    alert("데이터를 불러오지 못했습니다. 서버가 실행 중인지 확인하세요.");
  }
}

// 시작 화면 소개 (선택이 아니라 안내용 — 난이도는 노출하지 않음)
function renderIntros() {
  const si = $("scenario-intro");
  si.innerHTML = "";
  scenarios.forEach((s) => {
    const el = document.createElement("div");
    el.className = "intro-item";
    el.innerHTML = `<div class="it-name">${s.name}</div><div class="it-desc">${s.description}</div>`;
    si.appendChild(el);
  });
  const pi = $("persona-intro");
  pi.innerHTML = "";
  personas.forEach((p) => {
    const el = document.createElement("div");
    el.className = "intro-item";
    el.innerHTML = `<div class="it-name">${p.name} (${p.age}세)</div><div class="it-desc">${p.personality}</div>`;
    pi.appendChild(el);
  });
}

// ===== 상담 시작 (랜덤 선택) =====
startBtn.onclick = async () => {
  const name = nameInput.value.trim();
  if (!name) {
    alert("지원자 이름을 입력해 주세요.");
    nameInput.focus();
    return;
  }
  applicantName = name;
  selectedScenario = pickRandom(scenarios);
  selectedPersona = pickRandom(personas);

  history = [];
  turnCount = 0;
  messagesEl.innerHTML = "";
  currentBrand = pickRandom(BRANDS);

  $("chat-title").textContent = `📞 ${selectedScenario.name}`;
  $("chat-sub").textContent = `고객: ${selectedPersona.name} (${selectedPersona.age}세) · ${selectedPersona.personality}`;
  $("process-text").textContent = selectedScenario.process || "(안내된 프로세스가 없습니다.)";
  const guide = $("process-guide");
  if (guide) guide.open = true;

  setupScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");

  // 챗봇 상담 신청 접수 안내
  addSystemNote(
    `💬 채팅 상담이 연결되었습니다.<br>` +
      `<b>브랜드:</b> ${currentBrand.name} &nbsp;·&nbsp; <b>관리자 ID:</b> ${currentBrand.adminId}<br>` +
      `담당자가 문의 내용을 작성하면 확인 작업을 시작합니다.`
  );

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
      setBusy(false);
      chatText.focus();
      return;
    }
    addMessage("customer", data.reply, `고객(${selectedPersona.name})`);
    history.push({ role: "assistant", content: data.reply });

    // 고객이 상담을 끝내는 발화([상담종료] 감지)면 자동 종료 플로우로 이어간다
    if (data.ended) {
      finishByCustomer();
      return; // 입력창은 잠근 채로 둔다
    }
    setBusy(false);
    chatText.focus();
  } catch (e) {
    typing.remove();
    addMessage("customer", "⚠️ 서버와 통신할 수 없습니다.", "시스템");
    setBusy(false);
    chatText.focus();
  }
}

// 평가서 백그라운드 저장 (상담사 발화가 있을 때만)
function saveEvaluation() {
  if (turnCount === 0) return false;
  fetch("/api/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      applicantName,
      scenarioId: selectedScenario.id,
      personaId: selectedPersona.id,
      history,
    }),
  }).catch(() => {});
  return true;
}

// 고객이 먼저 상담을 종료한 경우: 시스템 메시지 → 입력창 잠금 유지 → 자동 종료/평가
function finishByCustomer() {
  setBusy(true); // 입력창 잠금 유지
  addSystemNote("🔔 고객님이 상담을 종료하였습니다.");
  saveEvaluation();
  setTimeout(() => showEnded(), 1600);
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

// ===== 상담 종료 (지원자에겐 결과 비공개, 평가는 백그라운드 저장) =====
endBtn.onclick = () => {
  if (turnCount === 0) {
    showEnded("상담 내용이 없어 평가서는 생성되지 않았습니다.");
    return;
  }
  saveEvaluation(); // 평가서 백그라운드 저장 (지원자에게는 보여주지 않음)
  showEnded();
};

function showEnded(msg) {
  $("ended-text").innerHTML = msg || "수고하셨습니다.<br>평가 결과는 면접관이 확인합니다.";
  endedModal.classList.remove("hidden");
}

$("ended-home").onclick = goToSetup;

// 채팅 중 나가기 (평가 저장 없이)
$("back-btn").onclick = () => {
  if (turnCount > 0 && !confirm("상담을 종료하고 나가시겠어요? 이 경우 평가서가 저장되지 않습니다.")) {
    return;
  }
  goToSetup();
};

// ===== 평가 기록 (면접관용, 비밀번호 게이트) =====
$("open-records").onclick = openGate;
$("records-back").onclick = goToSetup;
$("gate-cancel").onclick = () => gateModal.classList.add("hidden");
$("gate-ok").onclick = tryGate;
$("gate-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryGate();
});

function openGate() {
  $("gate-input").value = "";
  $("gate-error").classList.add("hidden");
  gateModal.classList.remove("hidden");
  $("gate-input").focus();
}
function tryGate() {
  if ($("gate-input").value.trim() === RECORDS_PASSWORD) {
    gateModal.classList.add("hidden");
    showRecords();
  } else {
    $("gate-error").classList.remove("hidden");
    $("gate-input").value = "";
    $("gate-input").focus();
  }
}

function showRecords() {
  setupScreen.classList.add("hidden");
  recordsScreen.classList.remove("hidden");
  $("records-list").innerHTML = "<p class='records-empty'>불러오는 중…</p>";
  loadRecords();
}

const delBtnHtml = '<button class="record-del" title="삭제">🗑</button>';

async function loadRecords() {
  const list = $("records-list");
  try {
    const records = await (await fetch("/api/evaluations")).json();
    if (!records.length) {
      list.innerHTML = "<p class='records-empty'>아직 저장된 평가가 없어요.<br>지원자가 상담을 마치면 여기에 쌓입니다.</p>";
      stopPolling();
      return;
    }
    list.innerHTML = "";
    let anyGenerating = false;
    records.forEach((r) => {
      const d = DIFFICULTY[r.difficulty] || { label: r.difficulty, cls: "" };
      const status = r.status || "done";
      const item = document.createElement("div");
      const sub = `${r.scenarioName} · ${r.personaName} · ${new Date(r.createdAt).toLocaleString("ko-KR")}`;

      if (status === "generating") {
        anyGenerating = true;
        item.className = "record-item generating";
        item.innerHTML =
          `<div class="record-status">⏳<br>생성 중</div>` +
          `<div class="record-info"><div class="record-name">${r.applicantName}</div>` +
          `<div class="record-sub">${r.scenarioName} · ${r.personaName} · 평가서를 작성하고 있어요…</div></div>` +
          delBtnHtml;
      } else if (status === "error") {
        item.className = "record-item";
        item.innerHTML =
          `<div class="record-status err">⚠️<br>실패</div>` +
          `<div class="record-info"><div class="record-name">${r.applicantName}</div>` +
          `<div class="record-sub">${sub}</div></div>` +
          delBtnHtml;
        item.querySelector(".record-info").onclick = () => openRecordDetail(r.id);
      } else {
        item.className = "record-item";
        item.innerHTML =
          `<div class="record-score">${r.score ?? "-"}<small>/100</small></div>` +
          `<div class="record-info"><div class="record-name">${r.applicantName} <span class="badge ${d.cls}">${d.label}</span></div>` +
          `<div class="record-sub">${sub}</div></div>` +
          delBtnHtml;
        item.querySelector(".record-info").onclick = () => openRecordDetail(r.id);
      }

      const del = item.querySelector(".record-del");
      if (del)
        del.onclick = (e) => {
          e.stopPropagation();
          deleteRecord(r.id);
        };
      list.appendChild(item);
    });
    if (anyGenerating) startPolling();
    else stopPolling();
  } catch (e) {
    list.innerHTML = "<p class='records-empty'>목록을 불러오지 못했어요.</p>";
    stopPolling();
  }
}

function startPolling() {
  if (!recordsPollTimer) recordsPollTimer = setInterval(loadRecords, 3000);
}
function stopPolling() {
  if (recordsPollTimer) {
    clearInterval(recordsPollTimer);
    recordsPollTimer = null;
  }
}

async function deleteRecord(id) {
  if (!confirm("이 평가서를 삭제할까요? 되돌릴 수 없습니다.")) return;
  try {
    await fetch(`/api/evaluations/${id}`, { method: "DELETE" });
    loadRecords();
  } catch (e) {
    alert("삭제하지 못했습니다.");
  }
}

async function openRecordDetail(id) {
  try {
    const r = await (await fetch(`/api/evaluations/${id}`)).json();
    showEvalModal(r);
  } catch (e) {
    alert("평가서를 불러오지 못했습니다.");
  }
}

// 평가서 모달 (기록 열람 — 면접관)
function showEvalModal(data) {
  currentEvalId = data.id || null;
  const meta = $("eval-meta");
  const body = $("eval-body");
  const d = DIFFICULTY[data.difficulty] || { label: data.difficulty, cls: "" };

  let html =
    `<span>👤 ${data.applicantName || "이름 미입력"}</span>` +
    `<span class="turns">· ${data.scenarioName}</span>` +
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
  primary.textContent = "닫기";
  primary.onclick = () => summaryModal.classList.add("hidden");
  summaryModal.classList.remove("hidden");
}

$("eval-download").onclick = () => {
  if (currentEvalId) window.location.href = `/api/evaluations/${currentEvalId}/download`;
};

// ===== 화면 전환 =====
function goToSetup() {
  stopPolling();
  setBusy(false); // 입력창 잠금 해제 (자동 종료 후 대비)
  gateModal.classList.add("hidden");
  endedModal.classList.add("hidden");
  summaryModal.classList.add("hidden");
  chatScreen.classList.add("hidden");
  recordsScreen.classList.add("hidden");
  setupScreen.classList.remove("hidden");
  selectedScenario = null;
  selectedPersona = null;
}

init();
