/**
 * 戰績保存：走場域宿主的 Durable KV（`/api/kv/<key>`）。
 * GET 回 200 文字或 404；PUT 帶文字 body 回 204。
 * 這裡的純函式（normalizeStats／recordRound／withDailyProgress）都有測試覆蓋。
 */

import { MAX_GUESSES } from "./game.js";

export const STATS_KEY = "pg-worddawn:stats";
export const STATS_ENDPOINT = `/api/kv/${STATS_KEY}`;

export const DEFAULT_STATS = Object.freeze({
  bestScore: 0,
  bestStreak: 0,
  streak: 0,
  played: 0,
  wins: 0,
  distribution: Object.freeze([0, 0, 0, 0, 0, 0]),
  daily: null,
});

const int = (value, fallback = 0) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * 把（可能壞掉的）已存資料整理成完整的戰績物件。
 * @param {unknown} raw
 */
export function normalizeStats(raw) {
  const src = raw && typeof raw === "object" ? /** @type {Record<string, any>} */ (raw) : {};
  const distribution = Array.from({ length: MAX_GUESSES }, (_, i) =>
    int(Array.isArray(src.distribution) ? src.distribution[i] : 0)
  );
  const daily =
    src.daily && typeof src.daily === "object" && typeof src.daily.date === "string"
      ? {
          date: src.daily.date,
          guesses: Array.isArray(src.daily.guesses)
            ? src.daily.guesses
                .filter((w) => typeof w === "string")
                .map((w) => w.toUpperCase())
                .slice(0, MAX_GUESSES)
            : [],
          status: ["playing", "won", "lost"].includes(src.daily.status) ? src.daily.status : "playing",
        }
      : null;
  return {
    bestScore: int(src.bestScore),
    bestStreak: int(src.bestStreak),
    streak: int(src.streak),
    played: int(src.played),
    wins: int(src.wins),
    distribution,
    daily,
  };
}

/**
 * 記一局的結果。
 * @param {ReturnType<typeof normalizeStats>} stats
 * @param {{status:'won'|'lost', tries:number, score:number, streak:number}} round
 */
export function recordRound(stats, round) {
  const base = normalizeStats(stats);
  const won = round.status === "won";
  const distribution = [...base.distribution];
  if (won && round.tries >= 1 && round.tries <= MAX_GUESSES) {
    distribution[round.tries - 1] += 1;
  }
  const streak = int(round.streak);
  return {
    ...base,
    played: base.played + 1,
    wins: base.wins + (won ? 1 : 0),
    distribution,
    bestScore: Math.max(base.bestScore, int(round.score)),
    streak,
    bestStreak: Math.max(base.bestStreak, streak),
  };
}

/**
 * 記下今天那題進行到哪，重新整理時可以接回去。
 * @param {ReturnType<typeof normalizeStats>} stats
 * @param {{date:string, guesses:string[], status:'playing'|'won'|'lost'}} daily
 */
export function withDailyProgress(stats, daily) {
  return {
    ...normalizeStats(stats),
    daily: {
      date: daily.date,
      guesses: [...daily.guesses],
      status: daily.status,
    },
  };
}

/**
 * 取回今天那題的存檔；不是今天的就當作沒有。
 * @param {ReturnType<typeof normalizeStats>} stats
 * @param {string} today
 */
export function dailyProgressFor(stats, today) {
  const daily = normalizeStats(stats).daily;
  return daily && daily.date === today ? daily : null;
}

/**
 * @param {typeof fetch} [fetcher]
 */
export async function loadStats(fetcher = fetch) {
  try {
    const res = await fetcher(STATS_ENDPOINT);
    if (!res.ok) return normalizeStats(null);
    const text = await res.text();
    return normalizeStats(text ? JSON.parse(text) : null);
  } catch {
    return normalizeStats(null);
  }
}

/**
 * @param {ReturnType<typeof normalizeStats>} stats
 * @param {typeof fetch} [fetcher]
 */
export async function saveStats(stats, fetcher = fetch) {
  const clean = normalizeStats(stats);
  try {
    await fetcher(STATS_ENDPOINT, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(clean),
    });
  } catch {
    /* 離線就算了，下一次還會再存 */
  }
  return clean;
}
