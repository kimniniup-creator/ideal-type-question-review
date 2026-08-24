import { DECKS as MAIN_DECKS } from "./questions.js";
import { MODULE as AGENT_MODULE } from "./questions-v2/agent.js";
import { MODULE as BESTIE_MODULE } from "./questions-v2/bestie.js";
import { MODULE as BOSS_MODULE } from "./questions-v2/boss.js";
import { KING_QUESTIONS } from "./questions-v2/king.js";
import { MODULE as LOVER_MODULE } from "./questions-v2/lover.js";
import { MODULE as ROOMMATE_MODULE } from "./questions-v2/roommate.js";
import { MODULE as TEACHER_MODULE } from "./questions-v2/teacher.js";

const STORAGE_KEY = "ideal-type-question-review-v2";
const SCHEMA_VERSION = 2;
const SPICE_LABELS = {
  1: "1 · 日常安全区",
  2: "2 · 有争议但不冒犯",
  3: "3 · 有成人暗示，但不露骨",
  4: "4 · 明显成人向",
  5: "5 · 私密重口局",
};
const STATUS_LABELS = {
  pending: "待审",
  needs_action: "NO · 待处理",
  keep: "已保留",
  revise: "已改写",
  delete: "已删除",
  skipped: "稍后再审",
};
const VARIANT_LABELS = { m: "男版", f: "女版", n: "TA版" };
const QUESTION_PREFIXES = {
  m: "这是一个满分男，但是——",
  f: "这是一个满分女，但是——",
  n: "这是一个满分的 TA，但是——",
};

const SOURCES = [
  {
    key: "main",
    name: "线上恋爱主库",
    noun: "理想型",
    status: "live",
    statusLabel: "线上使用中",
    decks: MAIN_DECKS,
  },
  {
    key: "agent",
    name: AGENT_MODULE.name,
    noun: AGENT_MODULE.noun || "满分 Agent",
    status: "retired",
    statusLabel: "已停用",
    decks: AGENT_MODULE.decks,
  },
  {
    key: "bestie",
    name: BESTIE_MODULE.name,
    noun: BESTIE_MODULE.noun || BESTIE_MODULE.name,
    status: "off",
    statusLabel: "功能开关关闭",
    decks: BESTIE_MODULE.decks,
  },
  {
    key: "boss",
    name: BOSS_MODULE.name,
    noun: BOSS_MODULE.noun || BOSS_MODULE.name,
    status: "off",
    statusLabel: "功能开关关闭",
    decks: BOSS_MODULE.decks,
  },
  {
    key: "king",
    name: "国王指令",
    noun: "国王命令",
    status: "archive",
    statusLabel: "独立指令库",
    decks: { king: { name: "国王游戏", questions: KING_QUESTIONS } },
    plainText: true,
  },
  {
    key: "lover-v2",
    name: `${LOVER_MODULE.name} · 旧 V2`,
    noun: LOVER_MODULE.noun || LOVER_MODULE.name,
    status: "archive",
    statusLabel: "未接线旧分库",
    decks: LOVER_MODULE.decks,
  },
  {
    key: "roommate",
    name: ROOMMATE_MODULE.name,
    noun: ROOMMATE_MODULE.noun || ROOMMATE_MODULE.name,
    status: "archive",
    statusLabel: "未接线旧分库",
    decks: ROOMMATE_MODULE.decks,
  },
  {
    key: "teacher",
    name: TEACHER_MODULE.name,
    noun: TEACHER_MODULE.noun || TEACHER_MODULE.name,
    status: "archive",
    statusLabel: "未接线旧分库",
    decks: TEACHER_MODULE.decks,
  },
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const questions = SOURCES.flatMap((source) =>
  Object.entries(source.decks || {}).flatMap(([deckKey, deck]) =>
    (deck.questions || []).map((question, sourceIndex) => {
      const fallbackText = String(question.text || question.n || question.m || question.f || "");
      return {
        ...question,
        moduleKey: source.key,
        moduleName: source.name,
        moduleNoun: source.noun,
        moduleStatus: source.status,
        moduleStatusLabel: source.statusLabel,
        plainText: Boolean(source.plainText),
        deckKey,
        deckName: deck.name || deckKey,
        deckDescription: deck.desc || "",
        sourceIndex,
        original: {
          m: String(question.m || fallbackText),
          f: String(question.f || fallbackText),
          n: String(question.n || fallbackText),
        },
      };
    }),
  ),
);

const questionById = new Map(questions.map((question) => [question.id, question]));
const datasetFingerprint = `${questions.length}:${questions[0]?.id || "none"}:${questions.at(-1)?.id || "none"}`;

const defaultState = () => ({
  schemaVersion: SCHEMA_VERSION,
  datasetFingerprint,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  currentId: questions[0]?.id || null,
  variant: "n",
  filters: { module: "all", deck: "all", pool: "all", status: "all", search: "" },
  calibration: { venue: "", maxSpice: 3, hardLimits: [], note: "", savedAt: null },
  reviews: {},
  events: [],
  undoStack: [],
});

let state = loadState();
let cardShownAt = Date.now();
let undoTimer = null;
let toastTimer = null;
let saveTimer = null;

function loadState() {
  const fallback = defaultState();
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      ...fallback,
      ...parsed,
      filters: { ...fallback.filters, ...(parsed.filters || {}) },
      calibration: { ...fallback.calibration, ...(parsed.calibration || {}) },
      reviews: parsed.reviews && typeof parsed.reviews === "object" ? parsed.reviews : {},
      events: Array.isArray(parsed.events) ? parsed.events.slice(-5000) : [],
      undoStack: Array.isArray(parsed.undoStack) ? parsed.undoStack.slice(-30) : [],
      datasetFingerprint,
    };
  } catch (error) {
    console.warn("题库反馈恢复失败，将使用新进度。", error);
    return fallback;
  }
}

function persist(immediate = false) {
  state.updatedAt = new Date().toISOString();
  $("#saveState")?.classList.add("saving");
  const write = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      const label = $("#saveState span:last-child");
      if (label) label.textContent = "已自动保存到这台设备";
    } catch (error) {
      console.error("题库反馈保存失败", error);
      showToast("自动保存失败，请先导出 JSON 备份");
    }
    $("#saveState")?.classList.remove("saving");
  };
  window.clearTimeout(saveTimer);
  if (immediate) write();
  else saveTimer = window.setTimeout(write, 180);
}

function statusOf(question) {
  return state.reviews[question.id]?.decision || "pending";
}

function currentQuestion() {
  return questionById.get(state.currentId) || null;
}

function currentText(question, variant = state.variant) {
  const review = state.reviews[question.id];
  const edited = ["needs_action", "revise"].includes(review?.decision) ? review?.editedText?.[variant] : "";
  return edited || question.original[variant] || question.original.n;
}

function filteredQuestions() {
  const search = state.filters.search.trim().toLowerCase();
  return questions.filter((question) => {
    if (state.filters.module !== "all" && question.moduleKey !== state.filters.module) return false;
    if (state.filters.deck !== "all" && question.deckKey !== state.filters.deck) return false;
    if (state.filters.pool !== "all" && !(question.pools || []).includes(state.filters.pool)) return false;
    const status = statusOf(question);
    if (state.filters.status === "pending" && status !== "pending") return false;
    if (state.filters.status !== "all" && state.filters.status !== "pending" && status !== state.filters.status) return false;
    if (!search) return true;
    const haystack = [question.id, question.deckName, ...(question.tags || []), ...(question.pools || []), ...Object.values(question.original)].join(" ").toLowerCase();
    return haystack.includes(search);
  });
}

function ensureCurrentVisible(list = filteredQuestions()) {
  if (!list.length) return null;
  if (!list.some((question) => question.id === state.currentId)) state.currentId = list[0].id;
  return questionById.get(state.currentId) || list[0];
}

function reviewCounts() {
  const counts = { pending: 0, needs_action: 0, keep: 0, revise: 0, delete: 0, skipped: 0 };
  questions.forEach((question) => { counts[statusOf(question)] += 1; });
  counts.done = counts.keep + counts.revise + counts.delete;
  counts.toDecide = questions.length - counts.done;
  return counts;
}

function recordEvent(action, question, extra = {}) {
  state.events.push({
    at: new Date().toISOString(),
    action,
    questionId: question?.id || null,
    variant: state.variant,
    dwellMs: Math.max(0, Date.now() - cardShownAt),
    ...extra,
  });
  if (state.events.length > 5000) state.events = state.events.slice(-5000);
}

function snapshotForUndo(question, message) {
  state.undoStack.push({
    questionId: question.id,
    previousReview: state.reviews[question.id] ? structuredClone(state.reviews[question.id]) : null,
    previousCurrentId: state.currentId,
    message,
    at: new Date().toISOString(),
  });
  state.undoStack = state.undoStack.slice(-30);
}

function upsertReview(question, patch) {
  const now = new Date().toISOString();
  const previous = state.reviews[question.id] || {
    questionId: question.id,
    firstSeenAt: now,
    visits: 0,
    dwellMs: 0,
    reasons: [],
    scale: "",
    note: "",
    editedText: {},
  };
  state.reviews[question.id] = {
    ...previous,
    ...patch,
    reasons: patch.reasons || previous.reasons || [],
    editedText: { ...(previous.editedText || {}), ...(patch.editedText || {}) },
    visits: (previous.visits || 0) + 1,
    dwellMs: (previous.dwellMs || 0) + Math.max(0, Date.now() - cardShownAt),
    lastVariant: state.variant,
    updatedAt: now,
  };
  return state.reviews[question.id];
}

function nextFromList(direction = 1, list = filteredQuestions()) {
  if (!list.length) return;
  const index = Math.max(0, list.findIndex((question) => question.id === state.currentId));
  const nextIndex = (index + direction + list.length) % list.length;
  state.currentId = list[nextIndex].id;
  cardShownAt = Date.now();
}

function decideKeep() {
  const question = currentQuestion();
  if (!question) return;
  const listBefore = filteredQuestions();
  snapshotForUndo(question, "原样保留");
  const review = upsertReview(question, { decision: "keep", decidedAt: new Date().toISOString() });
  review.editedText = {};
  review.reasons = [];
  review.scale = "";
  review.note = "";
  recordEvent("keep", question);
  nextFromList(1, listBefore);
  persist(true);
  render();
  showUndo("已原样保留");
}

function openNoPanel() {
  const question = currentQuestion();
  if (!question) return;
  if (statusOf(question) !== "needs_action") {
    snapshotForUndo(question, "标记为 NO");
    upsertReview(question, { decision: "needs_action", noAt: new Date().toISOString() });
    recordEvent("no", question);
    persist(true);
  }
  render();
  $("#noPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  window.setTimeout(() => $("#rewriteInput")?.focus({ preventScroll: true }), 220);
}

function closeNoPanel() {
  $("#noPanel").hidden = true;
  $("#noButton").classList.remove("active");
}

function decideSkip() {
  const question = currentQuestion();
  if (!question) return;
  const listBefore = filteredQuestions();
  snapshotForUndo(question, "稍后再审");
  upsertReview(question, { decision: "skipped", skippedAt: new Date().toISOString() });
  recordEvent("skip", question);
  nextFromList(1, listBefore);
  persist(true);
  render();
  showUndo("已放进“稍后再审”，没有删除");
}

function decideRewrite() {
  const question = currentQuestion();
  if (!question) return;
  const input = $("#rewriteInput");
  const rewritten = input.value.trim();
  const original = question.original[state.variant].trim();
  if (!rewritten) return showValidation("改写内容不能为空；如果整题不要，请点“整题删除”。");
  if (rewritten === original) return showValidation("这句话还没有变化。可以修改后保留，或直接删除整题。");
  const listBefore = filteredQuestions();
  snapshotForUndo(question, "保存改写");
  const existing = state.reviews[question.id] || {};
  upsertReview(question, {
    decision: "revise",
    editedText: { [state.variant]: rewritten },
    reasons: existing.reasons || [],
    scale: existing.scale || "",
    note: $("#reviewNote").value.trim(),
    decidedAt: new Date().toISOString(),
  });
  recordEvent("revise", question, { originalLength: original.length, revisedLength: rewritten.length });
  nextFromList(1, listBefore);
  persist(true);
  render();
  showUndo("已保存改写并保留这道题");
}

function decideDelete() {
  const question = currentQuestion();
  if (!question) return;
  const listBefore = filteredQuestions();
  snapshotForUndo(question, "整题删除");
  const existing = state.reviews[question.id] || {};
  upsertReview(question, {
    decision: "delete",
    reasons: existing.reasons || [],
    scale: existing.scale || "",
    note: $("#reviewNote").value.trim(),
    decidedAt: new Date().toISOString(),
  });
  recordEvent("delete", question);
  nextFromList(1, listBefore);
  persist(true);
  render();
  showUndo("已标记整题删除");
}

function undoLast() {
  const item = state.undoStack.pop();
  if (!item) return;
  if (item.previousReview) state.reviews[item.questionId] = item.previousReview;
  else delete state.reviews[item.questionId];
  state.currentId = item.previousCurrentId;
  const question = questionById.get(item.questionId);
  recordEvent("undo", question, { undone: item.message });
  persist(true);
  $("#undoBar").hidden = true;
  render();
  showToast(`已撤销：${item.message}`);
}

function toggleReason(reason) {
  const question = currentQuestion();
  if (!question) return;
  const review = state.reviews[question.id] || upsertReview(question, { decision: "needs_action" });
  const reasons = new Set(review.reasons || []);
  if (reasons.has(reason)) reasons.delete(reason);
  else reasons.add(reason);
  review.reasons = [...reasons];
  review.updatedAt = new Date().toISOString();
  recordEvent("reason_toggle", question, { reason, selected: reasons.has(reason) });
  persist();
  renderNoPanel(question);
}

function setScale(scale) {
  const question = currentQuestion();
  if (!question) return;
  const review = state.reviews[question.id] || upsertReview(question, { decision: "needs_action" });
  review.scale = review.scale === scale ? "" : scale;
  review.updatedAt = new Date().toISOString();
  recordEvent("scale", question, { scale: review.scale });
  persist();
  renderNoPanel(question);
}

function saveDraft() {
  const question = currentQuestion();
  if (!question || statusOf(question) !== "needs_action") return;
  const review = state.reviews[question.id];
  review.editedText = { ...(review.editedText || {}), [state.variant]: $("#rewriteInput").value };
  review.note = $("#reviewNote").value;
  review.updatedAt = new Date().toISOString();
  persist();
}

function showValidation(message) {
  $("#validationMessage").textContent = message;
  $("#rewriteInput").focus();
}

function render() {
  renderCalibration();
  renderFilters();
  renderProgress();

  const list = filteredQuestions();
  const question = ensureCurrentVisible(list);
  const card = $("#questionCard");
  const empty = $("#emptyState");
  if (!question || !list.length) {
    card.hidden = true;
    empty.hidden = false;
    $("#positionLabel").textContent = "0 题";
    return;
  }

  card.hidden = false;
  empty.hidden = true;
  const listIndex = list.findIndex((item) => item.id === question.id);
  $("#positionLabel").textContent = `第 ${listIndex + 1} / ${list.length} 题`;
  $$("[data-variant]").forEach((button) => button.classList.toggle("active", button.dataset.variant === state.variant));

  const status = statusOf(question);
  $("#questionPrefix").textContent = question.plainText
    ? "国王命令——"
    : question.moduleKey === "main"
      ? QUESTION_PREFIXES[state.variant]
      : `这是一个${question.moduleNoun || question.moduleName}，但是——`;
  $("#questionText").textContent = currentText(question);
  $("#questionId").textContent = `ID · ${question.id}`;
  $("#questionTags").textContent = `标签 · ${(question.tags || []).join(" / ") || "无"}`;
  $("#metaPills").innerHTML = [
    `<span>${escapeHtml(question.moduleName)}</span>`,
    `<span class="source-${escapeHtml(question.moduleStatus)}">${escapeHtml(question.moduleStatusLabel)}</span>`,
    `<span>${escapeHtml(question.deckName)}</span>`,
    ...(Number.isFinite(Number(question.spice)) ? [`<span class="spice">尺度 ${question.spice} / 5</span>`] : []),
    ...((question.pools || []).map((pool) => `<span>${escapeHtml(poolLabel(pool))}</span>`)),
  ].join("");
  const statusEl = $("#reviewStatus");
  statusEl.textContent = STATUS_LABELS[status];
  statusEl.className = `review-status ${status}`;
  $("#keepButton").classList.toggle("active", status === "keep");
  $("#noButton").classList.toggle("active", ["needs_action", "revise", "delete"].includes(status));
  renderNoPanel(question);
}

function renderNoPanel(question) {
  const status = statusOf(question);
  const panel = $("#noPanel");
  const shouldShow = status === "needs_action";
  panel.hidden = !shouldShow;
  if (!shouldShow) return;
  const review = state.reviews[question.id] || {};
  $$("#reasonOptions [data-reason]").forEach((button) => button.classList.toggle("selected", (review.reasons || []).includes(button.dataset.reason)));
  $$("#scaleOptions [data-scale]").forEach((button) => button.classList.toggle("selected", review.scale === button.dataset.scale));
  $("#editVariantLabel").textContent = `正在改 ${VARIANT_LABELS[state.variant]}`;
  $("#rewriteInput").value = review.editedText?.[state.variant] ?? question.original[state.variant];
  $("#reviewNote").value = review.note || "";
  $("#validationMessage").textContent = "";
}

function renderProgress() {
  const counts = reviewCounts();
  const percent = questions.length ? Math.round((counts.done / questions.length) * 100) : 0;
  $("#progressPercent").textContent = `${percent}%`;
  $("#progressBar").style.width = `${percent}%`;
  $("#keepCount").textContent = counts.keep;
  $("#reviseCount").textContent = counts.revise;
  $("#deleteCount").textContent = counts.delete;
  $("#skippedCount").textContent = counts.skipped;
  $("#doneCount").textContent = counts.done;
  $("#totalCount").textContent = questions.length;
  $("#pendingCount").textContent = counts.toDecide;
}

function renderCalibration() {
  const calibration = state.calibration;
  $$("input[name='venue']").forEach((input) => { input.checked = input.value === calibration.venue; });
  $("#maxSpice").value = calibration.maxSpice || 3;
  $("#maxSpiceOutput").textContent = SPICE_LABELS[calibration.maxSpice || 3];
  $$("#hardLimitOptions input").forEach((input) => { input.checked = (calibration.hardLimits || []).includes(input.value); });
  $("#calibrationNote").value = calibration.note || "";
  if (calibration.savedAt) {
    const venueLabel = { friends: "普通朋友局", close: "熟人成人局", private: "私密成人局" }[calibration.venue] || "未定场合";
    $("#calibrationSummary").textContent = `${venueLabel} · 上限 ${calibration.maxSpice}/5 · ${(calibration.hardLimits || []).length} 条硬边界`;
  }
}

function renderFilters() {
  const moduleSelect = $("#moduleFilter");
  if (!moduleSelect.options.length) {
    moduleSelect.innerHTML = `<option value="all">全部题库（${questions.length}）</option>` + SOURCES.map((source) => {
      const count = questions.filter((question) => question.moduleKey === source.key).length;
      return `<option value="${escapeHtml(source.key)}">${escapeHtml(source.name)}（${count}）</option>`;
    }).join("");
  }
  const deckSelect = $("#deckFilter");
  if (!deckSelect.options.length) {
    const decks = new Map();
    questions.forEach((question) => {
      const current = decks.get(question.deckKey) || { name: question.deckName, count: 0 };
      current.count += 1;
      decks.set(question.deckKey, current);
    });
    deckSelect.innerHTML = `<option value="all">全部档位</option>` + [...decks.entries()].map(([key, deck]) => `<option value="${escapeHtml(key)}">${escapeHtml(deck.name)}（${deck.count}）</option>`).join("");
  }
  const poolSelect = $("#poolFilter");
  if (!poolSelect.options.length) {
    const pools = [...new Set(questions.flatMap((question) => question.pools || []))];
    poolSelect.innerHTML = `<option value="all">全部题池</option>` + pools.map((pool) => `<option value="${escapeHtml(pool)}">${escapeHtml(poolLabel(pool))}</option>`).join("");
  }
  moduleSelect.value = state.filters.module;
  deckSelect.value = state.filters.deck;
  poolSelect.value = state.filters.pool;
  $("#statusFilter").value = state.filters.status;
  if (document.activeElement !== $("#searchInput")) $("#searchInput").value = state.filters.search;
}

function saveCalibration() {
  const venue = $("input[name='venue']:checked")?.value || "";
  state.calibration = {
    venue,
    maxSpice: Number($("#maxSpice").value),
    hardLimits: $$("#hardLimitOptions input:checked").map((input) => input.value),
    note: $("#calibrationNote").value.trim(),
    savedAt: new Date().toISOString(),
  };
  recordEvent("calibration_saved", null, { calibration: state.calibration });
  persist(true);
  $("#calibrationShell").classList.add("collapsed");
  $("#calibrationToggle").setAttribute("aria-expanded", "false");
  renderCalibration();
  showToast("尺度已保存，后面仍可随时修改");
}

function setFilter(key, value) {
  state.filters[key] = value;
  const list = filteredQuestions();
  if (list.length) state.currentId = list[0].id;
  cardShownAt = Date.now();
  persist();
  render();
}

function resetFilters() {
  state.filters = { module: "all", deck: "all", pool: "all", status: "all", search: "" };
  state.currentId = questions[0]?.id || null;
  persist();
  render();
}

function changeQuestion(direction) {
  const question = currentQuestion();
  recordEvent(direction > 0 ? "next" : "previous", question);
  nextFromList(direction);
  persist();
  render();
}

function buildExportPayload() {
  const counts = reviewCounts();
  const reviews = questions
    .filter((question) => statusOf(question) !== "pending")
    .map((question) => {
      const review = state.reviews[question.id] || {};
      return {
        questionId: question.id,
        moduleKey: question.moduleKey,
        moduleName: question.moduleName,
        moduleStatus: question.moduleStatus,
        moduleStatusLabel: question.moduleStatusLabel,
        deckKey: question.deckKey,
        deckName: question.deckName,
        spice: question.spice,
        pools: question.pools || [],
        tags: question.tags || [],
        decision: review.decision,
        originalText: question.original,
        reviewedVariant: review.lastVariant || state.variant,
        editedText: review.editedText || {},
        reasons: review.reasons || [],
        scale: review.scale || "",
        note: review.note || "",
        dwellMs: review.dwellMs || 0,
        visits: review.visits || 0,
        updatedAt: review.updatedAt || null,
      };
    });
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "ideal-type-question-review",
    project: "理想型·加载中",
    source: "public/questions.js",
    datasetFingerprint,
    generatedAt: new Date().toISOString(),
    calibration: state.calibration,
    summary: {
      total: questions.length,
      completed: counts.done,
      keep: counts.keep,
      revise: counts.revise,
      delete: counts.delete,
      needsAction: counts.needs_action,
      skipped: counts.skipped,
      pending: counts.pending,
    },
    reviews,
    behaviorEvents: state.events,
  };
}

function exportJson() {
  const payload = buildExportPayload();
  downloadFile(`理想型加载中_题库反馈_${dateStamp()}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  recordEvent("export_json", currentQuestion(), { reviewed: payload.reviews.length });
  persist(true);
  showToast("反馈 JSON 已导出，把这个文件发给我即可");
}

function exportCsv() {
  const payload = buildExportPayload();
  const headers = ["题目ID", "题库", "上线状态", "档位", "尺度", "题池", "标签", "结果", "男版原题", "女版原题", "TA版原题", "改写版本", "改写内容", "原因", "尺度反馈", "备注", "停留秒数"];
  const rows = payload.reviews.map((item) => {
    const editedEntries = Object.entries(item.editedText || {});
    return [
      item.questionId, item.moduleName, item.moduleStatusLabel, item.deckName, item.spice, item.pools.join("|"), item.tags.join("|"), STATUS_LABELS[item.decision] || item.decision,
      item.originalText.m, item.originalText.f, item.originalText.n,
      editedEntries.map(([variant]) => VARIANT_LABELS[variant]).join("|"),
      editedEntries.map(([, text]) => text).join("|"), item.reasons.join("|"), item.scale, item.note, Math.round((item.dwellMs || 0) / 1000),
    ];
  });
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  downloadFile(`理想型加载中_题库反馈_${dateStamp()}.csv`, `\ufeff${csv}`, "text/csv;charset=utf-8");
  recordEvent("export_csv", currentQuestion(), { reviewed: payload.reviews.length });
  persist(true);
  showToast("CSV 已导出");
}

async function importJson(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.kind === "ideal-type-question-review" && Array.isArray(parsed.reviews)) {
      const importedReviews = {};
      parsed.reviews.forEach((review) => {
        if (!questionById.has(review.questionId)) return;
        importedReviews[review.questionId] = {
          questionId: review.questionId,
          decision: review.decision,
          editedText: review.editedText || {},
          reasons: review.reasons || [],
          scale: review.scale || "",
          note: review.note || "",
          dwellMs: review.dwellMs || 0,
          visits: review.visits || 0,
          updatedAt: review.updatedAt || new Date().toISOString(),
        };
      });
      state.reviews = { ...state.reviews, ...importedReviews };
      state.calibration = { ...state.calibration, ...(parsed.calibration || {}) };
      state.events = [...state.events, ...(parsed.behaviorEvents || [])].slice(-5000);
    } else if (parsed.reviews && typeof parsed.reviews === "object") {
      state = {
        ...state,
        ...parsed,
        filters: { ...state.filters, ...(parsed.filters || {}) },
        calibration: { ...state.calibration, ...(parsed.calibration || {}) },
        datasetFingerprint,
      };
    } else {
      throw new Error("不是有效的题库反馈文件");
    }
    recordEvent("import_json", currentQuestion(), { fileName: file.name });
    persist(true);
    render();
    showToast("反馈已导入，可以接着审");
  } catch (error) {
    console.error(error);
    showToast("导入失败：请选择本页导出的 JSON 文件");
  } finally {
    $("#importJson").value = "";
  }
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showUndo(message) {
  window.clearTimeout(undoTimer);
  $("#undoMessage").textContent = message;
  $("#undoBar").hidden = false;
  undoTimer = window.setTimeout(() => { $("#undoBar").hidden = true; }, 6000);
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function poolLabel(pool) {
  return ({ neutral: "通用池", "straight-m": "直女看男", "straight-f": "直男看女", gay: "男同看男", lesbian: "女同看女", all: "全人群" })[pool] || pool;
}

function dateStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function bindEvents() {
  $("#calibrationToggle").addEventListener("click", () => {
    const shell = $("#calibrationShell");
    shell.classList.toggle("collapsed");
    $("#calibrationToggle").setAttribute("aria-expanded", String(!shell.classList.contains("collapsed")));
  });
  $("#maxSpice").addEventListener("input", (event) => { $("#maxSpiceOutput").textContent = SPICE_LABELS[event.target.value]; });
  $("#saveCalibration").addEventListener("click", saveCalibration);
  $("#keepButton").addEventListener("click", decideKeep);
  $("#noButton").addEventListener("click", openNoPanel);
  $("#skipButton").addEventListener("click", decideSkip);
  $("#closeNoPanel").addEventListener("click", closeNoPanel);
  $("#saveRewrite").addEventListener("click", decideRewrite);
  $("#deleteQuestion").addEventListener("click", decideDelete);
  $("#prevQuestion").addEventListener("click", () => changeQuestion(-1));
  $("#nextQuestion").addEventListener("click", () => changeQuestion(1));
  $("#undoButton").addEventListener("click", undoLast);
  $("#showAllQuestions").addEventListener("click", resetFilters);
  $("#resetFilters").addEventListener("click", resetFilters);
  $("#moduleFilter").addEventListener("change", (event) => setFilter("module", event.target.value));
  $("#deckFilter").addEventListener("change", (event) => setFilter("deck", event.target.value));
  $("#poolFilter").addEventListener("change", (event) => setFilter("pool", event.target.value));
  $("#statusFilter").addEventListener("change", (event) => setFilter("status", event.target.value));
  $("#searchInput").addEventListener("input", (event) => setFilter("search", event.target.value));
  $("#exportJson").addEventListener("click", exportJson);
  $("#exportCsv").addEventListener("click", exportCsv);
  $("#importJson").addEventListener("change", (event) => importJson(event.target.files?.[0]));
  $("#rewriteInput").addEventListener("input", saveDraft);
  $("#reviewNote").addEventListener("input", saveDraft);

  $$("[data-variant]").forEach((button) => button.addEventListener("click", () => {
    saveDraft();
    state.variant = button.dataset.variant;
    const question = currentQuestion();
    if (state.reviews[question?.id]) state.reviews[question.id].lastVariant = state.variant;
    recordEvent("variant", question, { variant: state.variant });
    persist();
    render();
  }));
  $$("#reasonOptions [data-reason]").forEach((button) => button.addEventListener("click", () => toggleReason(button.dataset.reason)));
  $$("#scaleOptions [data-scale]").forEach((button) => button.addEventListener("click", () => setScale(button.dataset.scale)));
  $$('[data-status-filter]').forEach((button) => button.addEventListener("click", () => setFilter("status", button.dataset.statusFilter)));

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if (typing) return;
    if (event.key.toLowerCase() === "y") decideKeep();
    else if (event.key.toLowerCase() === "n") openNoPanel();
    else if (event.key.toLowerCase() === "s") decideSkip();
    else if (event.key === "ArrowLeft") changeQuestion(-1);
    else if (event.key === "ArrowRight") changeQuestion(1);
  });

  window.addEventListener("beforeunload", () => persist(true));
}

bindEvents();
if (state.calibration.savedAt) {
  $("#calibrationShell").classList.add("collapsed");
  $("#calibrationToggle").setAttribute("aria-expanded", "false");
}
render();
