import { describe, expect, it } from "vitest";
import {
  ABSENT,
  CORRECT,
  MAX_GUESSES,
  PRESENT,
  WORD_LENGTH,
  applyAction,
  createGame,
  dailyAnswer,
  dailySeed,
  dayNumber,
  deleteLetter,
  endlessAnswer,
  evaluateGuess,
  getLegalActions,
  getOutcome,
  letterStatuses,
  nextRound,
  puzzleNumber,
  rowToEmoji,
  roundScore,
  shareText,
  submitGuess,
  summarize,
  todayISO,
  typeLetter,
} from "./game.js";
import { ALLOWED, ANSWERS } from "./words.js";

/** 打完一整個單字（不送出）。 */
const typeWord = (state, word) => [...word].reduce(typeLetter, state);
/** 打完並送出。 */
const play = (state, word) => submitGuess(typeWord(state, word));
/** 找幾個一定不是答案的合法猜測。 */
const decoys = (answer, count) => ALLOWED.filter((w) => w !== answer).slice(0, count);

describe("evaluateGuess", () => {
  it("全中時整列都是綠色", () => {
    expect(evaluateGuess("CRANE", "CRANE")).toEqual(Array(5).fill(CORRECT));
  });

  it("完全沒中時整列都是灰色", () => {
    expect(evaluateGuess("MANGO", "TRIBE")).toEqual([
      ABSENT,
      ABSENT,
      ABSENT,
      ABSENT,
      ABSENT,
    ]);
  });

  it("字母存在但位置錯 → 黃色", () => {
    expect(evaluateGuess("MANGO", "GUAVA")).toEqual([
      PRESENT, // G 在答案裡但不在這格
      ABSENT,
      PRESENT, // A 錯位
      ABSENT,
      ABSENT,
    ]);
  });

  it("綠色優先於黃色：猜測重複字母時先配對位置正確的那個", () => {
    expect(evaluateGuess("BERRY", "ERROR")).toEqual([
      PRESENT,
      PRESENT,
      CORRECT,
      ABSENT,
      ABSENT,
    ]);
  });

  it("答案只有一個某字母時，猜測裡多出來的同字母是灰色", () => {
    expect(evaluateGuess("ALLOY", "LLAMA")).toEqual([
      PRESENT,
      CORRECT,
      PRESENT,
      ABSENT,
      ABSENT, // 第二個 A 沒配額了
    ]);
  });

  it("答案有兩個同字母時，黃色配額也是兩個", () => {
    expect(evaluateGuess("SPEED", "ERASE")).toEqual([
      PRESENT,
      ABSENT,
      ABSENT,
      PRESENT,
      PRESENT,
    ]);
  });

  it("大小寫一律正規化", () => {
    expect(evaluateGuess("crane", "Crane")).toEqual(Array(5).fill(CORRECT));
  });

  it("長度不對就丟錯，不會悄悄給出錯誤判定", () => {
    expect(() => evaluateGuess("CRANE", "CAT")).toThrow(TypeError);
    expect(() => evaluateGuess("CAT", "CRANE")).toThrow(TypeError);
  });

  it("能轉成分享用的方塊", () => {
    expect(rowToEmoji(evaluateGuess("BERRY", "ERROR"))).toBe("🟨🟨🟩⬛⬛");
  });
});

describe("每日種子", () => {
  it("同一天永遠得到同一個種子", () => {
    expect(dailySeed("2026-08-16")).toBe(dailySeed("2026-08-16"));
    expect(Number.isInteger(dailySeed("2026-08-16"))).toBe(true);
  });

  it("同一天永遠得到同一個答案", () => {
    const a = dailyAnswer("2026-08-16");
    const b = dailyAnswer("2026-08-16");
    expect(a).toBe(b);
    expect(ANSWERS).toContain(a);
  });

  it("不同日期會換題", () => {
    expect(dailyAnswer("2026-08-16")).not.toBe(dailyAnswer("2026-08-17"));
  });

  it("一個輪迴（詞庫長度）之內每個答案剛好出現一次", () => {
    const seen = new Set();
    for (let day = 0; day < ANSWERS.length; day++) {
      const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
      seen.add(dailyAnswer(date));
    }
    expect(seen.size).toBe(ANSWERS.length);
  });

  it("連續 400 天都不會連兩天同題，且答案都在詞庫裡", () => {
    let prev = null;
    for (let day = 0; day < 400; day++) {
      const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
      const word = dailyAnswer(date);
      expect(ANSWERS).toContain(word);
      expect(word).not.toBe(prev);
      prev = word;
    }
  });

  it("紀元前的日期也算得出來（天數為負）", () => {
    expect(dayNumber("2026-01-01")).toBe(0);
    expect(dayNumber("2025-12-31")).toBe(-1);
    expect(puzzleNumber("2026-01-01")).toBe(1);
    expect(ANSWERS).toContain(dailyAnswer("2025-12-31"));
  });

  it("日期格式錯誤要拒絕", () => {
    expect(() => dayNumber("2026/08/16")).toThrow(TypeError);
    expect(() => dayNumber("not-a-date")).toThrow(TypeError);
  });

  it("todayISO 回傳可直接餵回 dayNumber 的字串", () => {
    const iso = todayISO(new Date(2026, 7, 16, 23, 30));
    expect(iso).toBe("2026-08-16");
    expect(() => dayNumber(iso)).not.toThrow();
  });

  it("無盡模式的答案由 seed + 局數決定，可完整重現", () => {
    expect(endlessAnswer(1234, 0)).toBe(endlessAnswer(1234, 0));
    expect(ANSWERS).toContain(endlessAnswer(1234, 7));
    const first20 = Array.from({ length: 20 }, (_, i) => endlessAnswer(1234, i));
    expect(new Set(first20).size).toBeGreaterThan(5);
  });
});

describe("輸入", () => {
  it("打字會累積，滿五個就不再收", () => {
    let s = createGame({ mode: "endless", seed: 1 });
    s = typeWord(s, "CRANES");
    expect(s.current).toBe("CRANE");
    expect(s.error).toBe("full");
  });

  it("非字母一律忽略", () => {
    const s = createGame({ mode: "endless", seed: 1 });
    expect(typeLetter(typeLetter(s, "1"), "-").current).toBe("");
  });

  it("Backspace 刪最後一個；空的時候回報 empty", () => {
    let s = typeWord(createGame({ mode: "endless", seed: 1 }), "CR");
    s = deleteLetter(s);
    expect(s.current).toBe("C");
    s = deleteLetter(s);
    expect(s.current).toBe("");
    expect(deleteLetter(s).error).toBe("empty");
  });

  it("不會就地修改傳入的 state", () => {
    const s = createGame({ mode: "endless", seed: 5 });
    const snapshot = structuredClone(s);
    const next = typeLetter(s, "A");
    expect(s).toEqual(snapshot);
    expect(next).not.toBe(s);
  });
});

describe("送出猜測", () => {
  it("長度不足會被擋下，不消耗次數", () => {
    const s = submitGuess(typeWord(createGame({ mode: "endless", seed: 2 }), "CRA"));
    expect(s.error).toBe("too-short");
    expect(s.guesses).toHaveLength(0);
    expect(s.current).toBe("CRA");
  });

  it("不在允許詞表的五字母輸入會被拒絕，不消耗次數", () => {
    const start = createGame({ mode: "endless", seed: 2 });
    const s = play(start, "ZZZZZ");
    expect(s.error).toBe("unknown-word");
    expect(s.message).toContain("ZZZZZ");
    expect(s.guesses).toHaveLength(0);
    expect(s.status).toBe("playing");
  });

  it("合法猜測會記錄結果並清空輸入", () => {
    const start = createGame({ mode: "endless", seed: 2 });
    const s = play(start, ALLOWED.find((w) => w !== start.answer));
    expect(s.guesses).toHaveLength(1);
    expect(s.results[0]).toHaveLength(WORD_LENGTH);
    expect(s.current).toBe("");
    expect(s.error).toBeNull();
  });
});

describe("勝負", () => {
  it("猜中就贏，分數為正，並揭示答案", () => {
    const start = createGame({ mode: "daily", date: "2026-08-16" });
    const s = play(start, start.answer);
    expect(getOutcome(s)).toBe("won");
    expect(s.score).toBeGreaterThan(0);
    expect(summarize(s).answer).toBe(start.answer);
  });

  it("越早猜中分數越高", () => {
    expect(roundScore(1, 0)).toBeGreaterThan(roundScore(6, 0));
    expect(roundScore(3, 4)).toBeGreaterThan(roundScore(3, 0));
  });

  it("六次用完就輸，並揭示答案", () => {
    let s = createGame({ mode: "endless", seed: 11 });
    for (const word of decoys(s.answer, MAX_GUESSES)) s = play(s, word);
    expect(s.guesses).toHaveLength(MAX_GUESSES);
    expect(getOutcome(s)).toBe("lost");
    expect(s.message).toContain(s.answer);
    expect(summarize(s).answer).toBe(s.answer);
    expect(s.streak).toBe(0);
  });

  it("遊戲結束後不再接受輸入", () => {
    const start = createGame({ mode: "daily", date: "2026-08-16" });
    const won = play(start, start.answer);
    expect(typeLetter(won, "A").current).toBe("");
    expect(typeLetter(won, "A").error).toBe("finished");
    expect(deleteLetter(won).error).toBe("finished");
    expect(submitGuess(won).guesses).toHaveLength(1);
  });

  it("答案在還沒結束前不會出現在 summarize 裡", () => {
    const s = createGame({ mode: "daily", date: "2026-08-16" });
    expect(summarize(s).answer).toBeNull();
    expect(JSON.stringify(summarize(s))).not.toContain(s.answer);
  });
});

describe("鍵盤著色", () => {
  it("每個字母取最好的判定（綠 > 黃 > 灰）", () => {
    let s = createGame({ mode: "endless", seed: 3 });
    s = { ...s, answer: "MANGO" };
    s = play(s, "GUAVA");
    expect(letterStatuses(s).G).toBe(PRESENT);
    s = play(s, "IMAGE"); // 這裡的 G 落在正確位置
    const map = letterStatuses(s);
    expect(map.G).toBe(CORRECT); // 綠色蓋過先前的黃色
    expect(map.A).toBe(PRESENT);
    expect(map.U).toBe(ABSENT);
    expect(map.Z).toBeUndefined();
  });
});

describe("無盡模式", () => {
  it("贏了保住連勝與分數，下一局換題", () => {
    const start = createGame({ mode: "endless", seed: 21 });
    const won = play(start, start.answer);
    const next = nextRound(won);
    expect(next.streak).toBe(1);
    expect(next.score).toBe(won.score);
    expect(next.round).toBe(1);
    expect(next.status).toBe("playing");
    expect(next.guesses).toHaveLength(0);
  });

  it("輸了連勝歸零但保留最佳連勝", () => {
    let s = createGame({ mode: "endless", seed: 22 });
    s = nextRound(play(s, s.answer));
    expect(s.bestStreak).toBe(1);
    for (const word of decoys(s.answer, MAX_GUESSES)) s = play(s, word);
    const after = nextRound(s);
    expect(after.streak).toBe(0);
    expect(after.bestStreak).toBe(1);
  });

  it("局還沒結束時 nextRound 不生效", () => {
    const s = createGame({ mode: "endless", seed: 23 });
    expect(nextRound(s)).toBe(s);
  });
});

describe("動作介面", () => {
  it("進行中提供字母鍵，輸入滿五格才給 Enter", () => {
    const s = createGame({ mode: "endless", seed: 31 });
    expect(getLegalActions(s)).toContain("A");
    expect(getLegalActions(s)).not.toContain("ENTER");
    expect(getLegalActions(s)).not.toContain("BACKSPACE");
    const full = typeWord(s, "CRANE");
    expect(getLegalActions(full)).toContain("ENTER");
    expect(getLegalActions(full)).toContain("BACKSPACE");
    expect(getLegalActions(full)).not.toContain("A");
  });

  it("結束後只剩下一局", () => {
    const start = createGame({ mode: "daily", date: "2026-08-16" });
    expect(getLegalActions(play(start, start.answer))).toEqual(["NEXT"]);
  });

  it("applyAction 對應字母、Enter、Backspace", () => {
    let s = createGame({ mode: "endless", seed: 32 });
    s = ["C", "R", "A", "N", "E"].reduce(applyAction, s);
    expect(s.current).toBe("CRANE");
    s = applyAction(s, "BACKSPACE");
    expect(s.current).toBe("CRAN");
    s = applyAction(applyAction(s, "E"), "ENTER");
    expect(s.guesses).toEqual(["CRANE"]);
  });
});

describe("summarize 與分享", () => {
  it("提供 UI 需要的欄位", () => {
    const start = createGame({ mode: "daily", date: "2026-08-16" });
    const view = summarize(play(start, ALLOWED.find((w) => w !== start.answer)));
    expect(view.modeLabel).toBe("每日");
    expect(view.tries).toBe(`1/${MAX_GUESSES}`);
    expect(view.remaining).toBe(MAX_GUESSES - 1);
    expect(view.progress).toBe(Math.round((1 / MAX_GUESSES) * 100));
    expect(view.puzzleNumber).toBe(puzzleNumber("2026-08-16"));
    expect(view.results[0]).toHaveLength(WORD_LENGTH);
  });

  it("分享文字只有方塊，不洩漏答案", () => {
    const start = createGame({ mode: "daily", date: "2026-08-16" });
    const text = shareText(play(start, start.answer));
    expect(text).toContain(`#${puzzleNumber("2026-08-16")}`);
    expect(text).toContain(`1/${MAX_GUESSES}`);
    expect(text).toContain("🟩🟩🟩🟩🟩");
    expect(text).not.toContain(start.answer);
  });

  it("輸掉時分享文字標記 X", () => {
    let s = createGame({ mode: "endless", seed: 41 });
    for (const word of decoys(s.answer, MAX_GUESSES)) s = play(s, word);
    expect(shareText(s)).toContain(`X/${MAX_GUESSES}`);
  });
});
