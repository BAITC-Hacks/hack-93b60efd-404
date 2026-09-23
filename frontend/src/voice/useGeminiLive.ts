import { Behavior, FunctionResponseScheduling, GoogleGenAI, Modality, type Session } from '@google/genai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createGeminiToken } from '../api/client';
import type { TurnResponse } from '../api/types';

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'speaking' | 'processing';

interface Options {
  onInput: (text: string, finished: boolean) => void;
  onOutput: (text: string, finished: boolean) => void;
  onTool: (text: string, signal: AbortSignal, callId: string) => Promise<TurnResponse>;
  onRoute: (turn: TurnResponse, request: string, callId: string) => void;
  onToolError: (callId: string, detail: string) => void;
}

const INSTRUCTIONS = [
  'You are a warm, concise voice assistant for Saqta Insurance, a fictional insurer.',
  'Speak clean, idiomatic Russian or Kazakh, matching the caller and switching when they do.',
  'Never insert English, Spanish, Portuguese, or other languages unless the caller explicitly requests them.',
  'Talk like a helpful person, not a phone menu. Greet normally and answer who you are.',
  'For small talk, identity questions, and simple clarifications, respond directly in one or two short sentences.',
  'For any insurance price, policy, coverage, claim, change, purchase, human handoff, or follow-up to one of these,',
  'call resolve_insurance_request with the full current utterance. The backend owns all facts, routing, and actions.',
  'Never invent rates, statuses, policy terms, or a completed action. Wait for the tool result before stating one.',
  'For insurance requests, wait for the tool result before speaking. Do not promise to check or ask the caller to wait.',
  'Paraphrase the tool result naturally and accurately. If it asks for a detail or approval, ask the caller for it.',
  'Ask for one missing detail at a time and explain briefly why sensitive data such as an IIN is needed.',
  'If interrupted, stop speaking and listen. An interruption alone does not cancel a backend action.',
  'Tell the truth: operator requests are stored locally, not connected to a live operator.',
].join(' ');

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function enqueuePcm(data: string, context: AudioContext, queue: Set<AudioBufferSourceNode>, nextAt: { current: number }) {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  if (bytes.byteLength < 2) return;
  const samples = new DataView(bytes.buffer);
  const frame = context.createBuffer(1, bytes.byteLength / 2, 24000);
  const channel = frame.getChannelData(0);
  for (let index = 0; index < channel.length; index++) {
    channel[index] = samples.getInt16(index * 2, true) / 32768;
  }
  const source = context.createBufferSource();
  source.buffer = frame;
  source.connect(context.destination);
  const when = Math.max(context.currentTime + 0.025, nextAt.current);
  nextAt.current = when + frame.duration;
  queue.add(source);
  source.onended = () => queue.delete(source);
  source.start(when);
}

export function useGeminiLive({ onInput, onOutput, onTool, onRoute, onToolError }: Options) {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const levelRef = useRef(0);
  const callbacks = useRef({ onInput, onOutput, onTool, onRoute, onToolError });
  callbacks.current = { onInput, onOutput, onTool, onRoute, onToolError };
  const sessionRef = useRef<Session | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextAtRef = useRef({ current: 0 });
  const callsRef = useRef(new Map<string, AbortController>());
  const activeRef = useRef(false);
  const mutedRef = useRef(false);

  const supported = typeof window !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof AudioContext !== 'undefined';

  const clearPlayback = useCallback(() => {
    for (const source of sourcesRef.current) {
      try { source.stop(); } catch { /* already ended */ }
    }
    sourcesRef.current.clear();
    nextAtRef.current.current = 0;
    if (activeRef.current) setState('listening');
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    for (const controller of callsRef.current.values()) controller.abort();
    callsRef.current.clear();
    clearPlayback();
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    sessionRef.current?.close();
    sessionRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
    levelRef.current = 0;
    setState('idle');
  }, [clearPlayback]);

  const start = useCallback(async () => {
    if (activeRef.current || !supported) return;
    activeRef.current = true;
    mutedRef.current = false;
    setError(null);
    setState('connecting');
    try {
      const context = new AudioContext();
      contextRef.current = context;
      await context.resume();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const microphoneName = stream.getAudioTracks()[0]?.label ?? '';
      if (/fake (default )?audio input/i.test(microphoneName)) {
        throw new Error('В этом тестовом окне подключён поддельный микрофон. Откройте сайт в обычном Chrome или Edge.');
      }
      const token = await createGeminiToken();
      if (!activeRef.current) return;
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1beta' } });
      const session = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          systemInstruction: INSTRUCTIONS,
          tools: [{ functionDeclarations: [{
            name: 'resolve_insurance_request',
            description: 'Get the verified answer, scenario selection, and action status for any insurance-related customer utterance. Call for every insurance task or follow-up; do not answer such requests from memory.',
            behavior: Behavior.NON_BLOCKING,
            parametersJsonSchema: {
              type: 'object',
              properties: { utterance: { type: 'string', description: 'The complete current customer request in its spoken language.' } },
              required: ['utterance'],
            },
          }] }],
        },
        callbacks: {
          onmessage: (message) => {
            const content = message.serverContent;
            if (content?.interrupted) clearPlayback();
            const input = content?.inputTranscription;
            if (input?.text) callbacks.current.onInput(input.text, input.finished ?? false);
            const output = content?.outputTranscription;
            if (output?.text) callbacks.current.onOutput(output.text, output.finished ?? false);
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data && contextRef.current) {
                enqueuePcm(part.inlineData.data, contextRef.current, sourcesRef.current, nextAtRef.current);
                setState('speaking');
              }
            }
            if (content?.turnComplete && sourcesRef.current.size === 0 && activeRef.current) setState('listening');
            for (const id of message.toolCallCancellation?.ids ?? []) callsRef.current.get(id)?.abort();
            for (const call of message.toolCall?.functionCalls ?? []) {
              if (!call.id || call.name !== 'resolve_insurance_request') continue;
              const utterance = call.args?.utterance;
              if (typeof utterance !== 'string' || !utterance.trim()) {
                sessionRef.current?.sendToolResponse({ functionResponses: [{
                  id: call.id, name: call.name, response: { error: 'No customer utterance supplied' },
                }] });
                continue;
              }
              const controller = new AbortController();
              callsRef.current.set(call.id, controller);
              setState('processing');
      void callbacks.current.onTool(utterance, controller.signal, call.id!).then((turn) => {
                if (controller.signal.aborted || !activeRef.current) return;
                callbacks.current.onRoute(turn, utterance, call.id!);
                sessionRef.current?.sendToolResponse({ functionResponses: [{
                  id: call.id!, name: call.name!, scheduling: FunctionResponseScheduling.WHEN_IDLE,
                  response: { answer: turn.answer_text, route: turn.route, status: 'verified' },
                }] });
              }).catch((cause) => {
                if (controller.signal.aborted || !activeRef.current) return;
                const detail = 'Не удалось проверить данные. Повторите вопрос.';
                console.error('Insurance request failed', cause);
                callbacks.current.onToolError(call.id!, detail);
                setError(detail);
                sessionRef.current?.sendToolResponse({ functionResponses: [{
                  id: call.id!, name: call.name!, scheduling: FunctionResponseScheduling.WHEN_IDLE,
                  response: { error: detail },
                }] });
              }).finally(() => {
                callsRef.current.delete(call.id!);
                if (activeRef.current && sourcesRef.current.size === 0) setState('listening');
              });
            }
          },
          onerror: (cause) => { if (activeRef.current) {
            console.error('Voice connection failed', cause);
            setError('Голосовая связь прервалась. Начните разговор снова.');
          } },
          onclose: () => { if (activeRef.current) {
            for (const id of callsRef.current.keys()) {
              callbacks.current.onToolError(id, 'Ответ не получен. Повторите вопрос.');
            }
            setError('Голосовая связь прервалась. Начните разговор снова.');
            stop();
          } },
        },
      });
      if (!activeRef.current) { session.close(); return; }
      sessionRef.current = session;
      const microphone = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(2048, 1, 1);
      const silent = context.createGain();
      silent.gain.value = 0;
      microphone.connect(processor);
      processor.connect(silent);
      silent.connect(context.destination);
      processorRef.current = processor;
      processor.onaudioprocess = (event) => {
        if (!activeRef.current || mutedRef.current) return;
        const input = event.inputBuffer.getChannelData(0);
        const ratio = context.sampleRate / 16000;
        const pcm = new Int16Array(Math.floor(input.length / ratio));
        let sum = 0;
        for (let index = 0; index < pcm.length; index++) {
          const sample = Math.max(-1, Math.min(1, input[Math.min(input.length - 1, Math.round(index * ratio))]));
          sum += sample * sample;
          pcm[index] = Math.round(sample * 32767);
        }
        levelRef.current = Math.min(1, Math.sqrt(sum / Math.max(1, pcm.length)) * 7);
        session.sendRealtimeInput({
          audio: { data: toBase64(new Uint8Array(pcm.buffer)), mimeType: 'audio/pcm;rate=16000' },
        });
      };
      setState('listening');
    } catch (cause) {
      console.error('Voice start failed', cause);
      const detail = cause instanceof Error && cause.message.includes('поддельный микрофон')
        ? cause.message : 'Не удалось начать голосовой разговор. Проверьте соединение и попробуйте снова.';
      stop();
      setError(detail);
    }
  }, [clearPlayback, stop, supported]);

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    for (const track of streamRef.current?.getAudioTracks() ?? []) track.enabled = !muted;
    if (muted) sessionRef.current?.sendRealtimeInput({ audioStreamEnd: true });
  }, []);

  const sendText = useCallback((text: string) => {
    if (!sessionRef.current) throw new Error('Голосовое соединение ещё не готово');
    sessionRef.current.sendRealtimeInput({ text });
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { state, error, clearError: () => setError(null), levelRef, supported, start, stop, setMuted, sendText };
}
