/**
 * 晨間一字（pg-worddawn）── Wordle 系文字謎的純邏輯層。
 *
 * 所有函式都是純函式：吃 state、吐新 state，不改動傳入的物件，
 * 也不碰 DOM／計時器／隨機性以外的環境（隨機性一律由 seed 決定）。
 */

import { ANSWERS, ALLOWED, isAllowedGuess } from "./words.js";

export { ANSWERS, ALLOWED, isAllowedGuess };

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

/** 字母判定 */
export const CORRECT = "correct";
export const PRESENT = "present";
export const ABSENT = "absent";

/** 每日題的第 0 天（UTC）。 */
export const DAILY_EPOCH = "2026-01-01";

/** 混進每日種子的固定鹽，換掉它等於整套每日題重排。 */
const DAILY_SALT = "worddawn/v1";

const DAY_MS = 86_400_000;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const EMOJI = { [CORRECT]: "🟩", [PRESENT]: "🟨", [ABSENT]: "⬛" };

/**
 * FNV-1a 32-bit。字串 → 穩定的無號 32 位整數。
 * @param {string} text
 * @returns {number}
 */
export function fnv1a(text) {
  let hash = 2_166_136_261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * mulberry32：小而穩的 seeded PRNG。
 * @param {number} seed
 * @returns {() => number} 回傳 [0,1) 的亂數
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * 本機日曆的今天，格式 YYYY-MM-DD。
 * @param {Date} [now]
 * @returns {string}
 */
export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 把 YYYY-MM-DD 轉成距 DAILY_EPOCH 的整天數（以 UTC 計，避開時區飄移）。
 * @param {string} dateStr
 * @returns {number}
 */
export function dayNumber(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  if (!match) throw new TypeError(`日期格式必須是 YYYY-MM-DD，收到：${dateStr}`);
  const [, y, m, d] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  const [ey, em, ed] = DAILY_EPOCH.split("-").map(Number);
  const epochMs = Date.UTC(ey, em - 1, ed);
  return Math.round((ms - epochMs) / DAY_MS);
}

/** 這個日期是第幾號謎題（給玩家看的，從 1 起算）。 */
export function puzzleNumber(dateStr) {
  return dayNumber(dateStr) + 1;
}

/**
 * 每日種子：同一天必然相同，同一輪（每 N 天為一輪）共用一個種子。
 *
 * 天數 → 輪號（floor(day / 詞庫長度)）→ FNV-1a(`鹽:輪號`)。
 * 一輪之內用洗好的答案序列輪流出題，所以 N 天內不會重複同一個答案。
 *
 * @param {string} dateStr YYYY-MM-DD
 * @returns {number} 無號 32 位種子
 */
export function dailySeed(dateStr) {
  const day = dayNumber(dateStr);
  const cycle = Math.floor(day / ANSWERS.length);
  return fnv1a(`${DAILY_SALT}:${cycle}`);
}

/** @type {Map<number, readonly string[]>} */
const orderCache = new Map();

/**
 * 用種子把答案表做一次確定性的 Fisher–Yates 洗牌。
 * @param {number} seed
 * @returns {readonly string[]}
 */
export function shuffledAnswers(seed) {
  const key = seed >>> 0;
  const cached = orderCache.get(key);
  if (cached) return cached;
  const rnd = mulberry32(key);
  const list = [...ANSWERS];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const frozen = Object.freeze(list);
  orderCache.set(key, frozen);
  return frozen;
}

/**
 * 這一天的答案。同日同題、跨裝置一致。
 * @param {string} [dateStr]
 * @returns {string}
 */
export function dailyAnswer(dateStr = todayISO()) {
  const order = shuffledAnswers(dailySeed(dateStr));
  const n = order.length;
  const day = dayNumber(dateStr);
  return order[((day % n) + n) % n];
}

/**
 * 無盡模式第 round 局的答案（由 seed 決定，可重現）。
 * @param {number} seed
 * @param {number} round
 * @returns {string}
 */
export function endlessAnswer(seed, round) {
  const rnd = mulberry32(fnv1a(`${seed >>> 0}:${round}`));
  return ANSWERS[Math.floor(rnd() * ANSWERS.length)];
}

/**
 * Wordle 判定：先標綠（位置正確），剩下的字母才輪到黃（存在但錯位）。
 * 重複字母以「答案裡還剩幾個」為準，用完就是灰。
 *
 * @param {string} answer 五字母答案
 * @param {string} guess 五字母猜測
 * @returns {Array<'correct'|'present'|'absent'>}
 */
export function evaluateGuess(answer, guess) {
  const a = String(answer ?? "").toUpperCase();
  const g = String(guess ?? "").toUpperCase();
  if (a.length !== WORD_LENGTH || g.length !== WORD_LENGTH) {
    throw new TypeError(`answer 與 guess 都必須是 ${WORD_LENGTH} 個字母`);
  }
  const result = new Array(WORD_LENGTH).fill(ABSENT);
  /** @type {Record<string, number>} */
  const pool = {};
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (g[i] === a[i]) result[i] = CORRECT;
    else pool[a[i]] = (pool[a[i]] ?? 0) + 1;
  }
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] === CORRECT) continue;
    if (pool[g[i]] > 0) {
      result[i] = PRESENT;
      pool[g[i]] -= 1;
    }
  }
  return result;
}

/**
 * 把一列判定轉成分享用的方塊。
 * @param {Array<'correct'|'present'|'absent'>} row
 * @returns {string}
 */
export function rowToEmoji(row) {
  return row.map((s) => EMOJI[s] ?? EMOJI[ABSENT]).join("");
}

/**
 * @typedef {object} GameState
 * @property {'daily'|'endless'} mode
 * @property {string|null} date 每日模式的日期（YYYY-MM-DD）
 * @property {number|null} puzzleNumber 每日模式的題號
 * @property {number} seed 無盡模式的種子（每日模式沿用當日種子）
 * @property {number} round 無盡模式第幾局（從 0 起算）
 * @property {string} answer
 * @property {string[]} guesses 已送出的猜測
 * @property {Array<Array<'correct'|'present'|'absent'>>} results
 * @property {string} current 正在輸入的字母
 * @property {'playing'|'won'|'lost'} status
 * @property {string} message 給玩家看的一句話
 * @property {null|'too-short'|'unknown-word'|'finished'|'full'|'empty'} error
 * @property {number} streak 目前連勝
 * @property {number} bestStreak 本機最佳連勝
 * @property {number} score 累計分數
 * @property {number} lastRoundScore 上一局得分
 */

const randomSeed = () => (Math.random() * 0xffffffff) >>> 0;

/**
 * 開新局。
 * @param {object} [options]
 * @param {'daily'|'endless'} [options.mode]
 * @param {string} [options.date] 每日模式指定日期
 * @param {number} [options.seed] 無盡模式指定種子（可重現）
 * @param {number} [options.round]
 * @param {number} [options.streak]
 * @param {number} [options.bestStreak]
 * @param {number} [options.score]
 * @returns {GameState}
 */
export function createGame(options = {}) {
  const mode = options.mode === "endless" ? "endless" : "daily";
  const round = Math.max(0, Math.trunc(options.round ?? 0));
  const date = mode === "daily" ? (options.date ?? todayISO()) : null;
  const seed =
    mode === "daily"
      ? dailySeed(/** @type {string} */ (date))
      : ((options.seed ?? randomSeed()) >>> 0);
  const answer = mode === "daily" ? dailyAnswer(/** @type {string} */ (date)) : endlessAnswer(seed, round);
  return {
    mode,
    date,
    puzzleNumber: mode === "daily" ? puzzleNumber(/** @type {string} */ (date)) : null,
    seed,
    round,
    answer,
    guesses: [],
    results: [],
    current: "",
    status: "playing",
    message:
      mode === "daily"
        ? `每日第 ${puzzleNumber(/** @type {string} */ (date))} 題 · 六次機會`
        : `無盡模式 · 第 ${round + 1} 局`,
    error: null,
    streak: Math.max(0, Math.trunc(options.streak ?? 0)),
    bestStreak: Math.max(0, Math.trunc(options.bestStreak ?? options.streak ?? 0)),
    score: Math.max(0, Math.trunc(options.score ?? 0)),
    lastRoundScore: 0,
  };
}

/**
 * 輸入一個字母（滿五個就不再收）。
 * @param {GameState} state
 * @param {string} letter
 * @returns {GameState}
 */
export function typeLetter(state, letter) {
  const ch = String(letter ?? "").toUpperCase();
  if (state.status !== "playing") return { ...state, error: "finished" };
  if (!/^[A-Z]$/.test(ch)) return state;
  if (state.current.length >= WORD_LENGTH) return { ...state, error: "full" };
  return { ...state, current: state.current + ch, error: null, message: "" };
}

/**
 * 刪掉最後一個字母。
 * @param {GameState} state
 * @returns {GameState}
 */
export function deleteLetter(state) {
  if (state.status !== "playing") return { ...state, error: "finished" };
  if (!state.current) return { ...state, error: "empty" };
  return { ...state, current: state.current.slice(0, -1), error: null, message: "" };
}

/**
 * 這一局猜中時拿多少分：越快越高，連勝再加成。
 * @param {number} tries
 * @param {number} streak
 * @returns {number}
 */
export function roundScore(tries, streak) {
  const base = (MAX_GUESSES + 1 - tries) * 100;
  const bonus = Math.min(streak, 10) * 25;
  return base + bonus;
}

/**
 * 送出目前輸入的猜測。長度不足或不在允許詞表都會被擋下，不消耗次數。
 * @param {GameState} state
 * @returns {GameState}
 */
export function submitGuess(state) {
  if (state.status !== "playing") {
    return { ...state, error: "finished", message: "這局已經結束了。" };
  }
  const guess = state.current.toUpperCase();
  if (guess.length < WORD_LENGTH) {
    return {
      ...state,
      error: "too-short",
      message: `還差 ${WORD_LENGTH - guess.length} 個字母。`,
    };
  }
  if (!isAllowedGuess(guess)) {
    return {
      ...state,
      error: "unknown-word",
      message: `詞庫裡沒有「${guess}」，換一個字。`,
    };
  }

  const result = evaluateGuess(state.answer, guess);
  const guesses = [...state.guesses, guess];
  const results = [...state.results, result];
  const won = guess === state.answer;
  const lost = !won && guesses.length >= MAX_GUESSES;

  if (won) {
    const streak = state.streak + 1;
    const gained = roundScore(guesses.length, streak);
    return {
      ...state,
      guesses,
      results,
      current: "",
      error: null,
      status: "won",
      streak,
      bestStreak: Math.max(state.bestStreak, streak),
      score: state.score + gained,
      lastRoundScore: gained,
      message: `${guesses.length} 次猜中 ${state.answer}，+${gained} 分。`,
    };
  }

  if (lost) {
    return {
      ...state,
      guesses,
      results,
      current: "",
      error: null,
      status: "lost",
      streak: 0,
      lastRoundScore: 0,
      message: `六次用完了，答案是 ${state.answer}。`,
    };
  }

  return {
    ...state,
    guesses,
    results,
    current: "",
    error: null,
    message: `還有 ${MAX_GUESSES - guesses.length} 次機會。`,
  };
}

/**
 * 無盡模式的下一局：贏了保住連勝與分數，輸了連勝歸零。
 * @param {GameState} state
 * @returns {GameState}
 */
export function nextRound(state) {
  if (state.status === "playing") return state;
  return createGame({
    mode: "endless",
    seed: state.mode === "endless" ? state.seed : randomSeed(),
    round: (state.mode === "endless" ? state.round : -1) + 1,
    streak: state.streak,
    bestStreak: state.bestStreak,
    score: state.score,
  });
}

/**
 * 鍵盤著色用：每個已用過的字母取最好的判定（綠 > 黃 > 灰）。
 * @param {GameState} state
 * @returns {Record<string, 'correct'|'present'|'absent'>}
 */
export function letterStatuses(state) {
  const rank = { [ABSENT]: 0, [PRESENT]: 1, [CORRECT]: 2 };
  /** @type {Record<string, 'correct'|'present'|'absent'>} */
  const map = {};
  state.guesses.forEach((guess, row) => {
    const result = state.results[row] ?? [];
    for (let i = 0; i < guess.length; i++) {
      const ch = guess[i];
      const status = result[i] ?? ABSENT;
      if (map[ch] === undefined || rank[status] > rank[map[ch]]) map[ch] = status;
    }
  });
  return map;
}

/**
 * @param {GameState} state
 * @returns {'playing'|'won'|'lost'}
 */
export function getOutcome(state) {
  return state.status;
}

/**
 * 目前可以做的動作：字母鍵、Backspace、Enter，結束後是下一局。
 * @param {GameState} state
 * @returns {string[]}
 */
export function getLegalActions(state) {
  if (state.status !== "playing") return ["NEXT"];
  /** @type {string[]} */
  const actions = [];
  if (state.current.length < WORD_LENGTH) actions.push(...LETTERS);
  if (state.current.length > 0) actions.push("BACKSPACE");
  if (state.current.length === WORD_LENGTH) actions.push("ENTER");
  return actions;
}

/**
 * 泛用入口：把一個動作字串套到 state 上。
 * @param {GameState} state
 * @param {string} action 單一字母、"ENTER"、"BACKSPACE" 或 "NEXT"
 * @returns {GameState}
 */
export function applyAction(state, action) {
  const key = String(action ?? "").toUpperCase();
  if (key === "ENTER") return submitGuess(state);
  if (key === "BACKSPACE") return deleteLetter(state);
  if (key === "NEXT") return nextRound(state);
  return typeLetter(state, key);
}

/**
 * 給 UI 的唯讀視圖。
 * @param {GameState} state
 */
export function summarize(state) {
  const finished = state.status !== "playing";
  return {
    mode: state.mode,
    modeLabel: state.mode === "daily" ? "每日" : "無盡",
    puzzleNumber: state.puzzleNumber,
    date: state.date,
    tries: `${state.guesses.length}/${MAX_GUESSES}`,
    remaining: MAX_GUESSES - state.guesses.length,
    current: state.current,
    guesses: [...state.guesses],
    results: state.results.map((row) => [...row]),
    letters: letterStatuses(state),
    streak: state.streak,
    bestStreak: state.bestStreak,
    score: state.score,
    lastRoundScore: state.lastRoundScore,
    outcome: state.status,
    /** 只有在結束後才揭示答案，避免 UI 不小心洩題。 */
    answer: finished ? state.answer : null,
    message: state.message,
    error: state.error,
    progress: Math.round((state.guesses.length / MAX_GUESSES) * 100),
  };
}

/**
 * 可貼到聊天室的成績單（不含答案）。
 * @param {GameState} state
 * @returns {string}
 */
export function shareText(state) {
  const head =
    state.mode === "daily"
      ? `晨間一字 #${state.puzzleNumber}`
      : `晨間一字 無盡 第 ${state.round + 1} 局`;
  const tries = state.status === "won" ? `${state.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  return [`${head} ${tries}`, ...state.results.map(rowToEmoji)].join("\n");
}
