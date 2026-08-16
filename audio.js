/**
 * 音效／音樂：播 `assets/audio/` 裡的實際檔案（Kenney CC0 音效、
 * Dylann Taylor "BLIPPY BITS" 背景樂）；署名見 ATTRIBUTION.md。
 *
 * 音樂檔比較大，所以預設關閉、按下才載入。
 */

const BASE = "./assets/audio";

/** @type {Record<string, {src: string, volume: number}>} */
const SFX = {
  key: { src: `${BASE}/click.ogg`, volume: 0.26 },
  erase: { src: `${BASE}/soft.ogg`, volume: 0.22 },
  submit: { src: `${BASE}/coin.ogg`, volume: 0.24 },
  reject: { src: `${BASE}/hit.ogg`, volume: 0.34 },
  win: { src: `${BASE}/ok.ogg`, volume: 0.55 },
  lose: { src: `${BASE}/hit.ogg`, volume: 0.45 },
};

const MUSIC_SRC = `${BASE}/music.ogg`;

export class GameAudio {
  constructor() {
    this.sfxEnabled = true;
    this.musicEnabled = false;
    this.unlocked = false;
    /** @type {Record<string, HTMLAudioElement>} */
    this.samples = {};
    /** @type {HTMLAudioElement | null} */
    this.music = null;
    if (typeof Audio === "undefined") return;
    for (const [name, { src, volume }] of Object.entries(SFX)) {
      const el = new Audio(src);
      el.preload = "auto";
      el.volume = volume;
      this.samples[name] = el;
    }
  }

  /** 第一次使用者互動時呼叫，滿足瀏覽器的自動播放限制。 */
  async unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.musicEnabled) await this.startMusic();
  }

  /**
   * @param {keyof typeof SFX | string} name
   */
  play(name) {
    if (!this.sfxEnabled) return;
    const sample = this.samples[name];
    if (!sample) return;
    // clone 一份才能連打時重疊，不會把上一聲切掉。
    const node = /** @type {HTMLAudioElement} */ (sample.cloneNode());
    node.volume = sample.volume;
    void node.play().catch(() => {});
  }

  /** @param {boolean} on */
  setSfx(on) {
    this.sfxEnabled = on;
    if (on) this.play("key");
  }

  /** @param {boolean} on */
  async setMusic(on) {
    this.musicEnabled = on;
    if (!on) {
      this.music?.pause();
      return;
    }
    await this.startMusic();
  }

  async startMusic() {
    if (typeof Audio === "undefined") return;
    if (!this.music) {
      this.music = new Audio(MUSIC_SRC);
      this.music.loop = true;
      this.music.volume = 0.18;
    }
    try {
      await this.music.play();
    } catch {
      /* 還沒拿到互動許可，下一次互動再試 */
    }
  }
}
