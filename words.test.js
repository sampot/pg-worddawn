import { describe, expect, it } from "vitest";
import { ALLOWED, ANSWERS, EXTRA_GUESSES, isAllowedGuess } from "./words.js";

const FIVE_LETTERS = /^[A-Z]{5}$/;

describe("詞庫", () => {
  it("答案表至少 80 個詞", () => {
    expect(ANSWERS.length).toBeGreaterThanOrEqual(80);
  });

  it("答案全部是五個大寫字母", () => {
    const bad = ANSWERS.filter((w) => !FIVE_LETTERS.test(w));
    expect(bad).toEqual([]);
  });

  it("答案不重複", () => {
    expect(new Set(ANSWERS).size).toBe(ANSWERS.length);
  });

  it("額外猜測詞也全部是五個大寫字母且不重複", () => {
    expect(EXTRA_GUESSES.filter((w) => !FIVE_LETTERS.test(w))).toEqual([]);
    expect(new Set(EXTRA_GUESSES).size).toBe(EXTRA_GUESSES.length);
  });

  it("允許猜測詞表包含全部答案，而且比答案表大得多", () => {
    for (const word of ANSWERS) expect(ALLOWED).toContain(word);
    expect(ALLOWED.length).toBeGreaterThan(ANSWERS.length * 3);
  });

  it("答案表與額外表不重疊，合併後不重複", () => {
    const answers = new Set(ANSWERS);
    expect(EXTRA_GUESSES.filter((w) => answers.has(w))).toEqual([]);
    expect(new Set(ALLOWED).size).toBe(ALLOWED.length);
  });

  it("含有台味主題詞，且它們都是玩家猜得到的英文字", () => {
    for (const word of ["MANGO", "GUAVA", "BETEL", "LOTUS", "PEARL", "NIGHT", "STALL", "SNACK"]) {
      expect(ANSWERS).toContain(word);
    }
  });

  it("isAllowedGuess 認得詞表內的字（不分大小寫）", () => {
    expect(isAllowedGuess("CRANE")).toBe(true);
    expect(isAllowedGuess("crane")).toBe(true);
    expect(isAllowedGuess("Mango")).toBe(true);
  });

  it("isAllowedGuess 拒絕亂打、長度不符與空值", () => {
    expect(isAllowedGuess("ZZZZZ")).toBe(false);
    expect(isAllowedGuess("QWERT")).toBe(false);
    expect(isAllowedGuess("CAT")).toBe(false);
    expect(isAllowedGuess("")).toBe(false);
    expect(isAllowedGuess(undefined)).toBe(false);
  });
});
