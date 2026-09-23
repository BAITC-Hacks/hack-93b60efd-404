import type { Lang } from '../api/types';

let currentAudio: HTMLAudioElement | null = null;
let token = 0;
let speakingNow = false;
const listeners = new Set<(speaking: boolean) => void>();

function setSpeaking(v: boolean) {
  if (v === speakingNow) return;
  speakingNow = v;
  listeners.forEach((l) => l(v));
}

export function onSpeakingChange(cb: (speaking: boolean) => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function stopSpeaking() {
  token++;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  currentAudio?.pause();
  currentAudio = null;
  setSpeaking(false);
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
  const my = token;
  const clean = text.replace(/^\[демо\]\s*/, '');
  const ended = () => my === token && setSpeaking(false);

  return new Promise((resolve) => {
    const giveUp = setTimeout(() => resolve(null), 4000);
    const started = () => {
      clearTimeout(giveUp);
      if (my !== token) return resolve(null);
      setSpeaking(true);
      resolve(performance.now());
    };
    const failed = () => {
      clearTimeout(giveUp);
      ended();
      resolve(null);
    };

    if (audio?.b64) {
      const el = new Audio(`data:${audio.mime ?? 'audio/mpeg'};base64,${audio.b64}`);
      currentAudio = el;
      el.addEventListener('playing', started, { once: true });
      el.addEventListener('ended', ended, { once: true });
      el.play().catch(failed);
      return;
    }

    if (!('speechSynthesis' in window)) return failed();
    const u = new SpeechSynthesisUtterance(clean);
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? (lang === 'kk' ? 'kk-KZ' : 'ru-RU');
    u.rate = 1.05;
    u.onstart = started;
    u.onend = ended;
    u.onerror = failed;
    window.speechSynthesis.speak(u);
  });
}
