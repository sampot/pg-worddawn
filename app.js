/**
 * 晨間一字 ── UI 層。遊戲規則全在 game.js，這裡只負責畫面、輸入與保存。
 * 不使用 alert／confirm／prompt：所有回饋走頁內 toast 與結果面板。
 */

import {
  MAX_GUESSES,
  WORD_LENGTH,
  applyAction,
  createGame,
  nextRound,
  shareText,
  submitGuess,
  summarize,
  todayISO,
  typeLetter,
} from "./game.js";
import { GameAudio } from "./audio.js";
import {
  dailyProgressFor,
  loadStats,
  normalizeStats,
  recordRound,
  saveStats,
  withDailyProgress,
} from "./persist.js";

const $ = (selector) => /** @type {HTMLElement} */ (document.querySelector(selector));

const KEY_ROWS = [
  [..."QWERTYUIOP"],
  [..."ASDFGHJKL"],
  ["ENTER", ..."ZXCVBNM", "BACKSPACE"],
];
const KEY_LABEL = { ENTER: "送出", BACKSPACE: "⌫" };

/** 一列翻牌的總長度，時間到才公布結果。 */
const FLIP_STAGGER_MS = 160;
const REVEAL_MS = FLIP_STAGGER_MS * (WORD_LENGTH - 1) + 520;
const TOAST_MS = 2600;

const ui = {
  board: $("#board"),
  keyboard: $("#keyboard"),
  toast: $("#toast"),
  result: $("#result"),
  resultHead: $("#result-head"),
  resultAnswer: $("#result-answer"),
  resultShare: $("#result-share"),
  btnNext: $("#btn-next"),
  btnCopy: $("#btn-copy"),
  statPuzzle: $("#stat-puzzle"),
  statStreak: $("#stat-streak"),
  statBest: $("#stat-best"),
  statScore: $("#stat-score"),
  sfx: $("#sfx"),
  music: $("#music"),
  help: $("#help"),
  rules: /** @type {HTMLDetailsElement} */ ($("#rules")),
};

const audio = new GameAudio();

/** @type {HTMLElement[][]} */
const tiles = [];
/** @type {HTMLElement[]} */
const rows = [];
/** @type {Map<string, HTMLButtonElement>} */
const keys = new Map();

let stats = normalizeStats(null);
/** @type {'daily'|'endless'} */
let mode = "daily";
const games = {
  daily: createGame({ mode: "daily" }),
  endless: createGame({ mode: "endless" }),
};
let toastTimer = 0;
/** 翻牌動畫期間先不收輸入，避免結果面板跳出來時還在打字。 */
let busy = false;

const game = () => games[mode];

/* ── 建面板 ─────────────────────────────────────────── */

function buildBoard() {
  ui.board.textContent = "";
  for (let r = 0; r < MAX_GUESSES; r++) {
    const row = document.createElement("div");
    row.className = "row";
    row.setAttribute("role", "row");
    /** @type {HTMLElement[]} */
    const rowTiles = [];
    for (let c = 0; c < WORD_LENGTH; c++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.setAttribute("role", "gridcell");
      tile.style.setProperty("--i", String(c));
      row.append(tile);
      rowTiles.push(tile);
    }
    ui.board.append(row);
    rows.push(row);
    tiles.push(rowTiles);
  }
}

function buildKeyboard() {
  ui.keyboard.textContent = "";
  for (const row of KEY_ROWS) {
    const line = document.createElement("div");
    line.className = "krow";
    for (const key of row) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = key.length > 1 ? "key is-wide" : "key";
      button.textContent = KEY_LABEL[key] ?? key;
      button.dataset.key = key;
      button.setAttribute("aria-label", key === "BACKSPACE" ? "刪除" : key === "ENTER" ? "送出" : key);
      button.addEventListener("click", () => {
        press(key);
        button.blur();
      });
      line.append(button);
      keys.set(key, button);
    }
    ui.keyboard.append(line);
  }
}

/* ── 畫面 ───────────────────────────────────────────── */

function render() {
  const state = game();
  const view = summarize(state);

  for (let r = 0; r < MAX_GUESSES; r++) {
    const guess = view.guesses[r];
    const result = view.results[r];
    const pending = r === view.guesses.length ? view.current : "";
    for (let c = 0; c < WORD_LENGTH; c++) {
      const tile = tiles[r][c];
      const letter = guess ? guess[c] : (pending[c] ?? "");
      if (tile.textContent !== letter) tile.textContent = letter;
      const status = result ? result[c] : "";
      if (status) tile.dataset.status = status;
      else delete tile.dataset.status;
      tile.classList.toggle("is-filled", Boolean(letter) && !status);
      tile.setAttribute("aria-label", letter ? `${letter} ${statusLabel(status)}` : "空格");
    }
  }

  for (const [key, button] of keys) {
    if (key.length > 1) continue;
    const status = view.letters[key];
    if (status) button.dataset.status = status;
    else delete button.dataset.status;
  }

  ui.statPuzzle.textContent =
    state.mode === "daily" ? `#${view.puzzleNumber}` : `第 ${state.round + 1} 局`;
  ui.statStreak.textContent = String(view.streak);
  ui.statBest.textContent = String(Math.max(view.bestStreak, stats.bestStreak));
  ui.statScore.textContent = String(Math.max(view.score, stats.bestScore));

  if (state.status === "playing") hideResult();
}

const statusLabel = (status) =>
  status === "correct" ? "位置正確" : status === "present" ? "位置錯誤" : status === "absent" ? "不在答案中" : "";

/**
 * @param {string} text
 * @param {'warn'|'good'|''} [tone]
 */
function showToast(text, tone = "") {
  ui.toast.textContent = text;
  ui.toast.className = tone ? `toast is-${tone}` : "toast";
  clearTimeout(toastTimer);
  if (text) {
    toastTimer = window.setTimeout(() => {
      ui.toast.textContent = "";
      ui.toast.className = "toast";
    }, TOAST_MS);
  }
}

function shakeRow(index) {
  const row = rows[Math.min(index, MAX_GUESSES - 1)];
  row.classList.remove("is-invalid");
  void row.offsetWidth; // 重啟動畫
  row.classList.add("is-invalid");
}

function hideResult() {
  ui.result.hidden = true;
  ui.keyboard.hidden = false;
}

function showResult() {
  const state = game();
  const won = state.status === "won";
  ui.resultHead.textContent = won
    ? `${state.guesses.length}/${MAX_GUESSES} 猜中，+${state.lastRoundScore} 分`
    : "六次用完了";
  ui.resultAnswer.textContent = state.answer;
  ui.resultShare.textContent = shareText(state);
  ui.btnNext.textContent = state.mode === "daily" ? "玩無盡模式" : "下一局";
  ui.result.hidden = false;
  // 這局已結束，收起鍵盤讓結果面板在手機上完整可見。
  ui.keyboard.hidden = true;
  ui.btnNext.focus();
}

/* ── 輸入 ───────────────────────────────────────────── */

/**
 * @param {string} action 單一字母、"ENTER" 或 "BACKSPACE"
 */
function press(action) {
  void audio.unlock();
  if (busy) return;
  const before = game();
  if (before.status !== "playing") return;

  if (action === "ENTER") {
    const after = submitGuess(before);
    if (after.error) {
      audio.play("reject");
      shakeRow(before.guesses.length);
      showToast(after.message, "warn");
      return;
    }
    games[mode] = after;
    audio.play("submit");
    render();
    revealLastRow(after);
    return;
  }

  const after = applyAction(before, action);
  if (after.current !== before.current) {
    audio.play(action === "BACKSPACE" ? "erase" : "key");
    games[mode] = after;
    render();
  }
}

/**
 * 翻牌，翻完才公布勝負並存檔。
 * @param {import("./game.js").GameState} state
 */
function revealLastRow(state) {
  const index = state.guesses.length - 1;
  const rowTiles = tiles[index];
  busy = true;
  for (const tile of rowTiles) {
    tile.classList.remove("is-revealing");
    void tile.offsetWidth;
    tile.classList.add("is-revealing");
  }
  window.setTimeout(() => {
    for (const tile of rowTiles) tile.classList.remove("is-revealing");
    busy = false;
    finishReveal(state, index);
  }, REVEAL_MS);
}

/**
 * @param {import("./game.js").GameState} state
 * @param {number} index
 */
function finishReveal(state, index) {
  if (state.status === "playing") {
    showToast(state.message);
    void persist(state);
    return;
  }
  if (state.status === "won") {
    audio.play("win");
    rows[index].classList.add("is-won");
    showToast(state.message, "good");
  } else {
    audio.play("lose");
    showToast(state.message, "warn");
  }
  void persist(state);
  window.setTimeout(showResult, state.status === "won" ? 700 : 250);
}

/**
 * @param {import("./game.js").GameState} state
 */
async function persist(state) {
  let next = stats;
  if (state.status !== "playing") {
    next = recordRound(next, {
      status: state.status,
      tries: state.guesses.length,
      score: state.score,
      streak: state.streak,
    });
  }
  if (state.mode === "daily" && state.date) {
    next = withDailyProgress(next, {
      date: state.date,
      guesses: state.guesses,
      status: state.status,
    });
  }
  stats = next;
  render();
  await saveStats(stats);
}

/* ── 模式與按鈕 ─────────────────────────────────────── */

/**
 * 連勝是跨模式共用的，所以還沒開打的那一局要接上存檔裡的數字。
 * @param {import("./game.js").GameState} state
 */
function withCarriedStreak(state) {
  const bestStreak = Math.max(state.bestStreak, stats.bestStreak);
  if (state.guesses.length > 0 || state.status !== "playing") return { ...state, bestStreak };
  return { ...state, streak: stats.streak, bestStreak };
}

/** @param {'daily'|'endless'} target */
function setMode(target) {
  if (busy || mode === target) return;
  mode = target;
  games[target] = withCarriedStreak(games[target]);
  for (const button of document.querySelectorAll(".mode")) {
    const active = button instanceof HTMLElement && button.dataset.mode === target;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  for (const row of rows) row.classList.remove("is-won", "is-invalid");
  render();
  const state = game();
  if (state.status === "playing") showToast(state.message);
  else showResult();
}

function startNextRound() {
  const state = game();
  if (state.mode === "daily") {
    setMode("endless");
    if (games.endless.status !== "playing") {
      games.endless = nextRound(games.endless);
    }
    games.endless = withCarriedStreak(games.endless);
    showToast("每日題一天一次，先來無盡模式練功。");
  } else {
    games.endless = withCarriedStreak(nextRound(state));
  }
  for (const row of rows) row.classList.remove("is-won", "is-invalid");
  hideResult();
  render();
  audio.play("erase");
}

async function copyResult() {
  const text = shareText(game());
  try {
    await navigator.clipboard.writeText(text);
    showToast("成績已複製，去貼給朋友。", "good");
  } catch {
    showToast("這個瀏覽器不給複製，直接截圖上面的方塊吧。", "warn");
  }
}

/* ── 啟動 ───────────────────────────────────────────── */

function bindEvents() {
  for (const button of document.querySelectorAll(".mode")) {
    button.addEventListener("click", () => {
      void audio.unlock();
      const target = button instanceof HTMLElement ? button.dataset.mode : null;
      if (target === "daily" || target === "endless") setMode(target);
    });
  }

  ui.btnNext.addEventListener("click", () => {
    void audio.unlock();
    startNextRound();
  });
  ui.btnCopy.addEventListener("click", () => void copyResult());

  ui.sfx.addEventListener("click", () => {
    const on = ui.sfx.getAttribute("aria-pressed") !== "true";
    ui.sfx.setAttribute("aria-pressed", String(on));
    void audio.unlock();
    audio.setSfx(on);
    showToast(on ? "音效開" : "音效關");
  });

  ui.music.addEventListener("click", () => {
    const on = ui.music.getAttribute("aria-pressed") !== "true";
    ui.music.setAttribute("aria-pressed", String(on));
    void audio.unlock();
    void audio.setMusic(on);
    showToast(on ? "音樂開（第一次要等一下載入）" : "音樂關");
  });

  ui.help.addEventListener("click", () => {
    ui.rules.open = !ui.rules.open;
    if (ui.rules.open) ui.rules.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    // 焦點在按鈕／摘要上時，讓元件自己處理 Enter 與空白鍵。
    if (target instanceof HTMLElement && target.closest("button, summary, a, input, textarea")) {
      if (event.key === "Enter" || event.key === " ") return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (game().status === "playing") press("ENTER");
      else startNextRound();
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      press("BACKSPACE");
      return;
    }
    if (/^[a-zA-Z]$/.test(event.key)) {
      press(event.key.toUpperCase());
    }
  });
}

/** 把存檔裡今天的猜測重播一次，重新整理也能接回原本的盤面。 */
function restoreDaily() {
  const saved = dailyProgressFor(stats, todayISO());
  if (!saved || saved.guesses.length === 0) return;
  let state = createGame({ mode: "daily" });
  for (const word of saved.guesses) {
    const attempt = submitGuess([...word].reduce(typeLetter, state));
    if (attempt.error) break;
    state = attempt;
  }
  // 連勝／最佳連勝以存檔為準，重播只是為了還原盤面。
  games.daily = { ...state, streak: stats.streak, bestStreak: stats.bestStreak };
}

async function main() {
  buildBoard();
  buildKeyboard();
  bindEvents();
  stats = await loadStats();
  const carry = { streak: stats.streak, bestStreak: stats.bestStreak };
  games.daily = createGame({ mode: "daily", ...carry });
  games.endless = createGame({ mode: "endless", ...carry });
  restoreDaily();
  render();
  const state = game();
  if (state.status === "playing") showToast(state.message);
  else showResult();
}

void main();
