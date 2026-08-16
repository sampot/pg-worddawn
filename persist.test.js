import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_STATS,
  STATS_ENDPOINT,
  dailyProgressFor,
  loadStats,
  normalizeStats,
  recordRound,
  saveStats,
  withDailyProgress,
} from "./persist.js";

const ok = (body) => ({ ok: true, text: async () => body });

describe("戰績整理", () => {
  it("沒有存檔時給出乾淨的預設值", () => {
    expect(normalizeStats(null)).toEqual({ ...DEFAULT_STATS, distribution: [0, 0, 0, 0, 0, 0] });
  });

  it("壞掉的欄位會被修回合理值", () => {
    const stats = normalizeStats({
      bestScore: "abc",
      bestStreak: -4,
      played: 3.7,
      distribution: "nope",
      daily: { date: 42 },
    });
    expect(stats.bestScore).toBe(0);
    expect(stats.bestStreak).toBe(0);
    expect(stats.played).toBe(3);
    expect(stats.distribution).toEqual([0, 0, 0, 0, 0, 0]);
    expect(stats.daily).toBeNull();
  });
});

describe("記錄一局", () => {
  it("贏了會累加場次、勝場與次數分布，並更新最高分與最佳連勝", () => {
    const stats = recordRound(normalizeStats(null), {
      status: "won",
      tries: 3,
      score: 450,
      streak: 2,
    });
    expect(stats.played).toBe(1);
    expect(stats.wins).toBe(1);
    expect(stats.distribution[2]).toBe(1);
    expect(stats.bestScore).toBe(450);
    expect(stats.bestStreak).toBe(2);
  });

  it("輸了只累加場次，最高分與最佳連勝不倒退", () => {
    const before = recordRound(normalizeStats(null), {
      status: "won",
      tries: 2,
      score: 600,
      streak: 3,
    });
    const after = recordRound(before, { status: "lost", tries: 6, score: 600, streak: 0 });
    expect(after.played).toBe(2);
    expect(after.wins).toBe(1);
    expect(after.streak).toBe(0);
    expect(after.bestStreak).toBe(3);
    expect(after.bestScore).toBe(600);
    expect(after.distribution.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe("每日存檔", () => {
  it("只有同一天的存檔才會被接回去", () => {
    const stats = withDailyProgress(normalizeStats(null), {
      date: "2026-08-16",
      guesses: ["CRANE"],
      status: "playing",
    });
    expect(dailyProgressFor(stats, "2026-08-16")?.guesses).toEqual(["CRANE"]);
    expect(dailyProgressFor(stats, "2026-08-17")).toBeNull();
  });
});

describe("KV 讀寫", () => {
  it("讀取會打到 /api/kv 並解析 JSON", async () => {
    const fetcher = vi.fn(async () => ok(JSON.stringify({ bestScore: 900 })));
    const stats = await loadStats(fetcher);
    expect(fetcher).toHaveBeenCalledWith(STATS_ENDPOINT);
    expect(stats.bestScore).toBe(900);
  });

  it("讀取失敗（404／壞 JSON／離線）都退回預設值，不炸掉遊戲", async () => {
    expect((await loadStats(async () => ({ ok: false, text: async () => "" }))).bestScore).toBe(0);
    expect((await loadStats(async () => ok("{oops"))).bestScore).toBe(0);
    expect(
      (
        await loadStats(async () => {
          throw new Error("offline");
        })
      ).played
    ).toBe(0);
  });

  it("寫入用 PUT 送 JSON 到同一個 key", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, text: async () => "" }));
    await saveStats({ bestScore: 120, bestStreak: 2 }, fetcher);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(STATS_ENDPOINT);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body).bestScore).toBe(120);
  });
});
