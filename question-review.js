import { DECKS as MAIN_DECKS } from "./questions.js";
import { MODULE as AGENT_MODULE } from "./questions-v2/agent.js";
import { MODULE as BESTIE_MODULE } from "./questions-v2/bestie.js";
import { MODULE as BOSS_MODULE } from "./questions-v2/boss.js";
import { KING_QUESTIONS } from "./questions-v2/king.js";
import { MODULE as LOVER_MODULE } from "./questions-v2/lover.js";
import { MODULE as ROOMMATE_MODULE } from "./questions-v2/roommate.js";
import { MODULE as TEACHER_MODULE } from "./questions-v2/teacher.js";

const STORAGE_KEY = "ideal-type-question-review-v3";
const LEGACY_STORAGE_KEY = "ideal-type-question-review-v2";
const SCHEMA_VERSION = 3;
const VARIANT_LABELS = { m: "男版", f: "女版", n: "TA版" };
const QUESTION_PREFIXES = {
  m: "这是一个满分男，但是——",
  f: "这是一个满分女，但是——",
  n: "这是一个满分的 TA，但是——",
};

const SOURCES = [
  { key: "main", name: "线上恋爱主库", noun: "理想型", status: "live", statusLabel: "线上使用中", decks: MAIN_DECKS },
  { key: "agent", name: AGENT_MODULE.name, noun: AGENT_MODULE.noun || "满分 Agent", status: "retired", statusLabel: "已停用", decks: AGENT_MODULE.decks },
  { key: "bestie", name: BESTIE_MODULE.name, noun: BESTIE_MODULE.noun || BESTIE_MODULE.name, status: "off", statusLabel: "功能开关关闭", decks: BESTIE_MODULE.decks },
  { key: "boss", name: BOSS_MODULE.name, noun: BOSS_MODULE.noun || BOSS_MODULE.name, status: "off", statusLabel: "功能开关关闭", decks: BOSS_MODULE.decks },
  { key: "king", name: "国王指令", noun: "国王命令", status: "archive", statusLabel: "独立指令库", decks: { king: { name: "国王游戏", questions: KING_QUESTIONS } }, plainText: true },
  { key: "lover-v2", name: `${LOVER_MODULE.name} · 旧 V2`, noun: LOVER_MODULE.noun || LOVER_MODULE.name, status: "archive", statusLabel: "未接线旧分库", decks: LOVER_MODULE.decks },
  { key: "roommate", name: ROOMMATE_MODULE.name, noun: ROOMMATE_MODULE.noun || ROOMMATE_MODULE.name, status: "archive", statusLabel: "未接线旧分库", decks: ROOMMATE_MODULE.decks },
  { key: "teacher", name: TEACHER_MODULE.name, noun: TEACHER_MODULE.noun || TEACHER_MODULE.name, status: "archive", statusLabel: "未接线旧分库", decks: TEACHER_MODULE.decks },
];

const $ = (selector) => document.querySelector(selector);

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
  module: "all",
  completed: false,
  reviews: {},
  events: [],
});

let state = loadState();
let cardShownAt = Date.now();
let saveTimer = null;
let toastTimer = null;

function normalizeDecision(decision) {
  if (decision === "yes" || decision === "keep") return "yes";
  if (["no", "needs_action", "revise", "delete"].includes(decision)) return "no";
  return "";
}

function migrateReview(review = {}) {
  return {
    questionId: review.questionId,
    decision: normalizeDecision(review.decision),
    note: String(review.note || ""),
    firstSeenAt: review.firstSeenAt || review.updatedAt || new Date().toISOString(),
    decidedAt: review.decidedAt || null,
    updatedAt: review.updatedAt || new Date().toISOString(),
    dwellMs: Number(review.dwellMs || 0),
    visits: Number(review.visits || 0),
  };
}

function loadState() {
  const fallback = defaultState();
  try {
    const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const legacy = current ? null : JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "null");
    const parsed = current || legacy;
    if (!parsed || typeof parsed !== "object") return fallback;

    const importedReviews = {};
    if (Array.isArray(parsed.reviews)) {
      parsed.reviews.forEach((review) => {
        if (questionById.has(review.questionId)) importedReviews[review.questionId] = migrateReview(review);
      });
    } else if (parsed.reviews && typeof parsed.reviews === "object") {
      Object.entries(parsed.reviews).forEach(([questionId, review]) => {
        if (questionById.has(questionId)) importedReviews[questionId] = migrateReview({ ...review, questionId });
      });
    }

    const requestedModule = parsed.module || parsed.filters?.module || "all";
    const module = requestedModule === "all" || SOURCES.some((source) => source.key === requestedModule) ? requestedModule : "all";
    return {
      ...fallback,
      createdAt: parsed.createdAt || fallback.createdAt,
      currentId: questionById.has(parsed.currentId) ? parsed.currentId : fallback.currentId,
      variant: ["m", "f", "n"].includes(parsed.variant) ? parsed.variant : "n",
      module,
      completed: false,
      reviews: importedReviews,
      events: Array.isArray(parsed.events || parsed.behaviorEvents) ? (parsed.events || parsed.behaviorEvents).slice(-5000) : [],
    };
  } catch (error) {
    console.warn("题库反馈恢复失败，将使用新进度。", error);
    return fallback;
  }
}

function persist(immediate = false) {
  state.updatedAt = new Date().toISOString();
  $("#saveState").classList.add("saving");
  const write = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      $("#saveState span").textContent = "已自动保存";
    } catch (error) {
      console.error("题库反馈保存失败", error);
      showToast("自动保存失败，请先导出反馈备份");
    }
    $("#saveState").classList.remove("saving");
  };
  window.clearTimeout(saveTimer);
  if (immediate) write();
  else saveTimer = window.setTimeout(write, 160);
}

function visibleQuestions() {
  return state.module === "all" ? questions : questions.filter((question) => question.moduleKey === state.module);
}

function currentQuestion() {
  const list = visibleQuestions();
  if (!list.length) return null;
  const current = questionById.get(state.currentId);
  if (current && list.some((question) => question.id === current.id)) return current;
  state.currentId = list[0].id;
  return list[0];
}

function decisionOf(question) {
  return normalizeDecision(state.reviews[question.id]?.decision);
}

function reviewedCount(list = questions) {
  return list.reduce((count, question) => count + (decisionOf(question) ? 1 : 0), 0);
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

function ensureReview(question) {
  if (!state.reviews[question.id]) {
    state.reviews[question.id] = {
      questionId: question.id,
      decision: "",
      note: "",
      firstSeenAt: new Date().toISOString(),
      decidedAt: null,
      updatedAt: new Date().toISOString(),
      dwellMs: 0,
      visits: 0,
    };
  }
  return state.reviews[question.id];
}

function saveDraft() {
  const question = currentQuestion();
  if (!question) return;
  const review = ensureReview(question);
  review.note = $("#reviewNote").value;
  review.updatedAt = new Date().toISOString();
  persist();
}

function selectDecision(decision) {
  const question = currentQuestion();
  if (!question) return;
  const review = ensureReview(question);
  const previous = decisionOf(question);
  review.note = $("#reviewNote").value;
  review.decision = decision;
  review.decidedAt = new Date().toISOString();
  review.updatedAt = review.decidedAt;
  review.visits += 1;
  review.dwellMs += Math.max(0, Date.now() - cardShownAt);
  recordEvent("decision", question, { decision, previousDecision: previous || null, noteLength: review.note.trim().length });
  persist(true);
  render();
}

function moveQuestion(direction) {
  const list = visibleQuestions();
  const question = currentQuestion();
  if (!question || !list.length) return;
  saveDraft();
  const index = Math.max(0, list.findIndex((item) => item.id === question.id));

  if (direction > 0 && !decisionOf(question)) return;
  if (direction > 0 && index === list.length - 1) {
    state.completed = true;
    recordEvent("complete", question, { module: state.module });
    persist(true);
    render();
    return;
  }

  const nextIndex = Math.max(0, Math.min(list.length - 1, index + direction));
  if (nextIndex === index) return;
  recordEvent(direction > 0 ? "next" : "previous", question);
  state.currentId = list[nextIndex].id;
  state.completed = false;
  cardShownAt = Date.now();
  persist(true);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function render() {
  renderModuleOptions();
  const list = visibleQuestions();
  const question = currentQuestion();
  const listIndex = question ? list.findIndex((item) => item.id === question.id) : 0;
  const allReviewed = reviewedCount();

  $("#reviewedCount").textContent = allReviewed;
  $("#progressBar").style.width = `${questions.length ? (allReviewed / questions.length) * 100 : 0}%`;
  $("#positionLabel").textContent = question ? `第 ${listIndex + 1} / ${list.length} 题` : "没有题目";
  $("#variantFilter").value = state.variant;
  $("#moduleFilter").value = state.module;

  $("#questionCard").hidden = state.completed || !question;
  $("#completeCard").hidden = !state.completed;
  if (!question || state.completed) return;

  $("#moduleName").textContent = question.moduleName;
  $("#deckName").textContent = question.deckName;
  $("#questionPrefix").textContent = question.plainText
    ? "国王命令——"
    : question.moduleKey === "main"
      ? QUESTION_PREFIXES[state.variant]
      : `这是一个${question.moduleNoun || question.moduleName}，但是——`;
  $("#questionText").textContent = question.original[state.variant] || question.original.n;
  $("#questionId").textContent = `ID · ${question.id}`;

  const review = state.reviews[question.id] || {};
  if (document.activeElement !== $("#reviewNote")) $("#reviewNote").value = review.note || "";
  const decision = decisionOf(question);
  const yesButton = $("#keepButton");
  const noButton = $("#noButton");
  yesButton.classList.toggle("active", decision === "yes");
  noButton.classList.toggle("active", decision === "no");
  yesButton.setAttribute("aria-pressed", String(decision === "yes"));
  noButton.setAttribute("aria-pressed", String(decision === "no"));

  const stateLabel = $("#decisionState");
  stateLabel.textContent = decision === "yes" ? "已选 Yes" : decision === "no" ? "已选 No" : "未选择";
  stateLabel.className = `decision-state ${decision || "pending"}`;
  const hint = $("#selectionHint");
  hint.textContent = decision ? `已选 ${decision.toUpperCase()}，评价可留空，现在可以进入下一题` : "先选 Yes 或 No，才能进入下一题";
  hint.className = `selection-hint${decision ? " ready" : ""}`;
  $("#nextQuestion").disabled = !decision;
}

function renderModuleOptions() {
  const select = $("#moduleFilter");
  if (select.options.length) return;
  select.innerHTML = `<option value="all">全部题库（${questions.length}）</option>` + SOURCES.map((source) => {
    const count = questions.filter((question) => question.moduleKey === source.key).length;
    return `<option value="${escapeHtml(source.key)}">${escapeHtml(source.name)}（${count}）</option>`;
  }).join("");
}

function changeModule(module) {
  saveDraft();
  state.module = module;
  state.currentId = visibleQuestions()[0]?.id || null;
  state.completed = false;
  cardShownAt = Date.now();
  recordEvent("module", currentQuestion(), { module });
  persist(true);
  render();
}

function changeVariant(variant) {
  saveDraft();
  state.variant = variant;
  recordEvent("variant", currentQuestion(), { variant });
  persist(true);
  render();
}

function reviewAgain() {
  state.currentId = visibleQuestions()[0]?.id || null;
  state.completed = false;
  cardShownAt = Date.now();
  persist(true);
  render();
}

function buildExportPayload() {
  const reviewedQuestions = questions.filter((question) => decisionOf(question));
  const reviews = reviewedQuestions.map((question) => {
    const review = state.reviews[question.id];
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
      decision: decisionOf(question),
      feedback: review.note.trim(),
      note: review.note.trim(),
      originalText: question.original,
      reviewedVariant: state.variant,
      dwellMs: review.dwellMs || 0,
      visits: review.visits || 0,
      updatedAt: review.updatedAt || null,
    };
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "ideal-type-question-review",
    project: "理想型·加载中",
    datasetFingerprint,
    generatedAt: new Date().toISOString(),
    summary: {
      total: questions.length,
      reviewed: reviews.length,
      yes: reviews.filter((review) => review.decision === "yes").length,
      no: reviews.filter((review) => review.decision === "no").length,
      pending: questions.length - reviews.length,
    },
    reviews,
    behaviorEvents: state.events,
  };
}

async function exportFeedback() {
  saveDraft();
  const payload = buildExportPayload();
  const content = JSON.stringify(payload, null, 2);
  const name = `理想型加载中_题库反馈_${dateStamp()}.json`;
  const file = new File([content], name, { type: "application/json" });

  recordEvent("export", currentQuestion(), { reviewed: payload.reviews.length });
  persist(true);
  if (matchMedia("(pointer: coarse)").matches && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "理想型·加载中题库反馈", text: `已判断 ${payload.summary.reviewed} 题` });
      showToast("反馈已打开手机分享");
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("手机分享失败，改为下载文件。", error);
    }
  }

  downloadFile(name, content, "application/json;charset=utf-8");
  showToast("反馈已导出，把这个 JSON 文件发给我即可");
}

async function importFeedback(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.kind !== "ideal-type-question-review" || !Array.isArray(parsed.reviews)) throw new Error("invalid feedback");
    parsed.reviews.forEach((review) => {
      if (!questionById.has(review.questionId)) return;
      state.reviews[review.questionId] = migrateReview({ ...review, note: review.feedback ?? review.note });
    });
    recordEvent("import", currentQuestion(), { fileName: file.name, imported: parsed.reviews.length });
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

function showToast(message) {
  window.clearTimeout(toastTimer);
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2500);
}

function dateStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function bindEvents() {
  $("#keepButton").addEventListener("click", () => selectDecision("yes"));
  $("#noButton").addEventListener("click", () => selectDecision("no"));
  $("#nextQuestion").addEventListener("click", () => moveQuestion(1));
  $("#prevQuestion").addEventListener("click", () => moveQuestion(-1));
  $("#reviewNote").addEventListener("input", saveDraft);
  $("#moduleFilter").addEventListener("change", (event) => changeModule(event.target.value));
  $("#variantFilter").addEventListener("change", (event) => changeVariant(event.target.value));
  $("#exportJson").addEventListener("click", exportFeedback);
  $("#completeExport").addEventListener("click", exportFeedback);
  $("#reviewAgain").addEventListener("click", reviewAgain);
  $("#importJson").addEventListener("change", (event) => importFeedback(event.target.files?.[0]));

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if (typing) return;
    if (event.key.toLowerCase() === "y") selectDecision("yes");
    else if (event.key.toLowerCase() === "n") selectDecision("no");
    else if ((event.key === "Enter" || event.key === "ArrowRight") && decisionOf(currentQuestion())) moveQuestion(1);
    else if (event.key === "ArrowLeft") moveQuestion(-1);
  });

  window.addEventListener("beforeunload", () => persist(true));
}

bindEvents();
render();
