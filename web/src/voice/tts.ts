import type { Lang } from '../api/types';

let currentAudio: HTMLAudioElement | null = null;

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  currentAudio?.pause();
  currentAudio = null;
}

function pickVoice(lang: Lang): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const want = lang === 'kk' ? ['kk', 'ru'] : ['ru'];
  for (const prefix of want) {
    const v = voices.find((x) => x.lang.toLowerCase().startsWith(prefix));
    if (v) return v;
  }
  return undefined;
}

/** Resolves with performance.now() at the moment playback actually starts, or null if it never did. */
export function speak(text: string, lang: Lang, audio?: { b64: string; mime?: string | null }): Promise<number | null> {
  stopSpeaking();
  const clean = text.replace(/^\[демо\]\s*/, '');

  return new Promise((resolve) => {
    const giveUp = setTimeout(() => resolve(null), 4000);
    const started = () => {
      clearTimeout(giveUp);
      resolve(performance.now());
    };

    if (audio?.b64) {
      const el = new Audio(`data:${audio.mime ?? 'audio/mpeg'};base64,${audio.b64}`);
      currentAudio = el;
      el.addEventListener('playing', started, { once: true });
      el.play().catch(() => {
        clearTimeout(giveUp);
        resolve(null);
      });
      return;
    }

    if (!('speechSynthesis' in window)) {
      clearTimeout(giveUp);
      resolve(null);
      return;
    }
    const u = new SpeechSynthesisUtterance(clean);
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? (lang === 'kk' ? 'kk-KZ' : 'ru-RU');
    u.rate = 1.05;
    u.onstart = started;
    u.onerror = () => {
      clearTimeout(giveUp);
      resolve(null);
    };
    window.speechSynthesis.speak(u);
  });
}
