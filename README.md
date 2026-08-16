# 晨間一字 (`pg-worddawn`)

Wordle 系文字謎：六次機會猜出一個五字母英文單字。**每日**模式同日同題，**無盡**模式隨機出題衝連勝。

純 HTML／CSS／JavaScript（無 build step）。本機直接開 `index.html`，或經 Playgrounds／go 安裝成 SAM。

## 玩法

- 六次機會猜出五字母英文單字。
- 🟩 綠＝字母與位置都對；🟨 黃＝字母有但位置不對；⬛ 灰＝答案裡沒有。
- **只接受詞庫裡的單字**：不在允許詞表的五字母輸入會被退回並提示，**不消耗次數**。
- 螢幕虛擬鍵盤與實體鍵盤都能打字：<kbd>A</kbd>–<kbd>Z</kbd> 輸入、<kbd>Enter</kbd> 送出、<kbd>Backspace</kbd> 刪除。
- 猜中得分＝`(7 − 猜中次數) × 100 + min(連勝, 10) × 25`；六次用完就揭示答案、連勝歸零。

## 每日種子怎麼算

`game.js` 的 `dailySeed(date)`：

1. **天數**：把 `YYYY-MM-DD` 以 UTC 解析，算出距紀元 `DAILY_EPOCH = 2026-01-01` 的整天數 `day`（早於紀元就是負數）。用 UTC 算避免時區把同一天算成兩題。
2. **輪號**：`cycle = floor(day / ANSWERS.length)`。答案表每走完一輪就換一個新洗法。
3. **種子**：`dailySeed = FNV-1a 32-bit("worddawn/v1:" + cycle)`。
4. **洗牌**：用 `mulberry32(dailySeed)` 對答案表做確定性的 Fisher–Yates 洗牌，得到這一輪的出題順序。
5. **取題**：`dailyAnswer(date) = order[day mod ANSWERS.length]`。

所以同一天在任何裝置上都是同一題，而且**一輪（＝詞庫長度）之內每個答案剛好出現一次**，不會連日重複。改掉 `DAILY_SALT` 等於整套每日題重排。

無盡模式則是 `endlessAnswer(seed, round) = ANSWERS[mulberry32(FNV-1a(seed + ":" + round))]`；給定 seed 就能完整重現一整串題目，測試因此不必碰 `Math.random`。

## 詞庫

`words.js`：

- `ANSWERS`──130 個可能成為答案的常見五字母英文詞，混入夜市／水果／小吃等台味主題詞（`MANGO`、`GUAVA`、`BETEL`、`LOTUS`、`PEARL`、`NIGHT`、`STALL`、`SNACK`、`RAMEN`、`SUSHI`⋯），但每一個都是玩家猜得到的英文字。
- `EXTRA_GUESSES`──另外 925 個只允許猜、不會當答案的常見五字母詞。
- `ALLOWED = ANSWERS ∪ EXTRA_GUESSES`（共 1055 個），`isAllowedGuess()` 以此把關。

## 保存

最高分、最佳連勝、勝場分布與「今天那題猜到哪」都存在場域宿主的 Durable KV：`GET`／`PUT /api/kv/pg-worddawn:stats`。讀不到（離線、單機開檔）就退回預設值，遊戲照常能玩。

## 開發

```bash
npx vitest run
```

- `words.js`──詞庫
- `game.js`──純邏輯（判定、每日種子、模式、勝負、計分、分享），無 DOM
- `persist.js`──`/api/kv` 讀寫與戰績整理
- `app.js`／`index.html`／`styles.css`──UI（mobile-first；不使用 `alert`／`confirm`／`prompt`）
- `audio.js`──播 `assets/audio/` 的實際音檔

## 署名

見 [ATTRIBUTION.md](./ATTRIBUTION.md)。
