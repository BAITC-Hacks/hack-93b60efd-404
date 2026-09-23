import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribe } from '../api/client';
import type { Lang } from '../api/types';

export type SttEngine = 'browser' | 'server';
export type VoiceState = 'idle' | 'listening' | 'processing';

export interface FinalUtterance {
  text: string;
  stt_ms?: number;
  speechEndedAt: number;
  lang?: Lang;
}

interface Options {
  engine: SttEngine;
  lang: 'ru-RU' | 'kk-KZ';
  onFinal: (u: FinalUtterance) => void;
}

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onspeechend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getRecognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const SPEECH_RMS = 0.035;
const SILENCE_MS = 850;
const NO_SPEECH_TIMEOUT_MS = 8000;

const ERRORS: Record<string, string> = {
  'not-allowed': 'Нет доступа к микрофону. Разрешите его в настройках браузера.',
  'service-not-allowed': 'Браузер запретил распознавание речи. Откройте страницу в Chrome или переключитесь на серверное распознавание.',
  network: 'Браузерное распознавание требует интернета. Проверьте соединение.',
  'audio-capture': 'Микрофон не найден. Подключите его и попробуйте снова.',
  'language-not-supported': 'Браузер не распознаёт этот язык. Переключитесь на серверное распознавание.',
};

interface MicSession {
  stream: MediaStream;
  ctx: AudioContext;
  raf: number;
  recorder?: MediaRecorder;
}

export function useVoiceInput({ engine, lang, onFinal }: Options) {
  const [state, setState] = useState<VoiceState>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const levelRef = useRef(0);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const recRef = useRef<Recognition | null>(null);
  const micRef = useRef<MicSession | null>(null);
  const speechEndRef = useRef<number | null>(null);

  const supported =
    typeof window !== 'undefined' &&
    (engine === 'server'
      ? !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
      : !!getRecognitionCtor());

  const releaseMic = useCallback(() => {
    const m = micRef.current;
    if (!m) return;
    cancelAnimationFrame(m.raf);
    m.stream.getTracks().forEach((t) => t.stop());
    void m.ctx.close().catch(() => {});
    micRef.current = null;
    levelRef.current = 0;
  }, []);

  const openMic = useCallback(async (onSilence?: () => void): Promise<MicSession> => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const session: MicSession = { stream, ctx, raf: 0 };
    const startedAt = performance.now();
    let heard = false;
    let lastVoiceAt = startedAt;

    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const x = (buf[i] - 128) / 128;
        sum += x * x;
      }
      const rms = Math.sqrt(sum / buf.length);
      levelRef.current = Math.min(1, rms * 7);
      const now = performance.now();
      if (rms > SPEECH_RMS) {
        heard = true;
        lastVoiceAt = now;
      }
      if (onSilence && ((heard && now - lastVoiceAt > SILENCE_MS) || (!heard && now - startedAt > NO_SPEECH_TIMEOUT_MS))) {
        speechEndRef.current = heard ? lastVoiceAt : null;
        onSilence();
        return;
      }
      session.raf = requestAnimationFrame(tick);
    };
    session.raf = requestAnimationFrame(tick);
    micRef.current = session;
    return session;
  }, []);

  const startBrowser = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';

    rec.onresult = (e) => {
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else partial += r[0].transcript;
      }
      setInterim(`${finalText}${partial}`.trim());
    };
    rec.onspeechend = () => {
      speechEndRef.current = performance.now();
    };
    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') setError(ERRORS[e.error] ?? `Ошибка распознавания: ${e.error}`);
    };
    rec.onend = () => {
      const now = performance.now();
      const endedAt = speechEndRef.current ?? now;
      const text = finalText.trim();
      recRef.current = null;
      releaseMic();
      setInterim('');
      setState('idle');
      if (text) onFinalRef.current({ text, stt_ms: now - endedAt, speechEndedAt: endedAt });
    };

    recRef.current = rec;
    rec.start();
    openMic().catch(() => {});
  }, [lang, openMic, releaseMic]);

  const startServer = useCallback(async () => {
    const chunks: Blob[] = [];
    let session: MicSession;
    const stopRecorder = () => {
      if (session.recorder?.state === 'recording') session.recorder.stop();
    };
    session = await openMic(stopRecorder);
    const recorder = new MediaRecorder(session.stream);
    session.recorder = recorder;
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      const endedAt = speechEndRef.current ?? performance.now();
      releaseMic();
      if (!chunks.length || speechEndRef.current === null) {
        setState('idle');
        return;
      }
      setState('processing');
      const t0 = performance.now();
      try {
        const res = await transcribe(new Blob(chunks, { type: recorder.mimeType }), lang.slice(0, 2));
        const text = res.text.trim();
        if (text) {
          onFinalRef.current({
            text,
            stt_ms: res.stt_ms ?? performance.now() - t0,
            speechEndedAt: endedAt,
            lang: res.lang,
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Распознавание не удалось');
      } finally {
        setState('idle');
      }
    };
    recorder.start(250);
  }, [lang, openMic, releaseMic]);

  const start = useCallback(async () => {
    if (state !== 'idle') return;
    setError(null);
    setInterim('');
    speechEndRef.current = null;
    setState('listening');
    try {
      if (engine === 'browser') startBrowser();
      else await startServer();
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      setError(name === 'NotAllowedError' ? ERRORS['not-allowed'] : 'Не удалось включить микрофон.');
      releaseMic();
      setState('idle');
    }
  }, [engine, releaseMic, startBrowser, startServer, state]);

  const stop = useCallback(() => {
    if (recRef.current) {
      speechEndRef.current ??= performance.now();
      recRef.current.stop();
      return;
    }
    const rec = micRef.current?.recorder;
    if (rec?.state === 'recording') {
      speechEndRef.current ??= performance.now();
      rec.stop();
    }
  }, []);

  useEffect(
    () => () => {
      recRef.current?.abort();
      releaseMic();
    },
    [releaseMic],
  );

  return { state, interim, error, clearError: () => setError(null), levelRef, supported, start, stop };
}
