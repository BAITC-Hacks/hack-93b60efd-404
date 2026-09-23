import { audioUrl } from '../api/client';

let currentAudio: HTMLAudioElement | null = null;
let token = 0;
let speakingNow = false;
let cancelPendingStart: (() => void) | null = null;
const listeners = new Set<(speaking: boolean) => void>();

function setSpeaking(value: boolean) {
  if (value === speakingNow) return;
  speakingNow = value;
  listeners.forEach((listener) => listener(value));
}

export function onSpeakingChange(listener: (speaking: boolean) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function stopSpeaking() {
  token += 1;
  cancelPendingStart?.();
  cancelPendingStart = null;
  currentAudio?.pause();
  currentAudio = null;
  setSpeaking(false);
}

/** Returns the browser playback timestamp, not server-side TTS generation time. */
export async function speak(path: string): Promise<number | null> {
  stopSpeaking();
  const mine = token;
  const element = new Audio(audioUrl(path));
  currentAudio = element;
  return new Promise<number | null>((resolve, reject) => {
    let settled = false;
    cancelPendingStart = () => {
      if (settled) return;
      settled = true;
      resolve(null);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cancelPendingStart = null;
      if (mine === token) {
        currentAudio = null;
        setSpeaking(false);
      }
      reject(new Error('Не удалось воспроизвести ответ. Проверьте звук браузера.'));
    };
    element.addEventListener('playing', () => {
      if (mine !== token) return;
      settled = true;
      cancelPendingStart = null;
      setSpeaking(true);
      resolve(performance.now());
    }, { once: true });
    element.addEventListener('ended', () => {
      if (mine === token) {
        currentAudio = null;
        setSpeaking(false);
      }
    }, { once: true });
    element.addEventListener('error', fail, { once: true });
    element.play().catch(fail);
  });
}
