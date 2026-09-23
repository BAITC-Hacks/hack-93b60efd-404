import type { Health, TurnResponse } from './types';

const BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, '');

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    throw new Error(body?.message ?? body?.error ?? 'Сервер ответил ' + response.status);
  }
  return response.json() as Promise<T>;
}

export async function fetchHealth(): Promise<Health> {
  const response = await fetch(BASE + '/health');
  const health = await readResponse<Health>(response);
  if (health.status !== 'process_running') throw new Error('Бэкенд не готов к работе');
  return health;
}

export async function createSession(): Promise<string> {
  const response = await fetch(BASE + '/sessions', { method: 'POST' });
  const body = await readResponse<{ session_id: string }>(response);
  return body.session_id;
}

export async function sendText(sessionId: string, text: string, speak: boolean, signal?: AbortSignal): Promise<TurnResponse> {
  const response = await fetch(BASE + '/sessions/' + sessionId + '/turns/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, speak }),
    signal,
  });
  return readResponse<TurnResponse>(response);
}

export async function createGeminiToken(): Promise<string> {
  const response = await fetch(BASE + '/gemini/token', { method: 'POST' });
  if (!response.ok) throw new Error('Голосовая связь недоступна. Попробуйте ещё раз.');
  const token = await readResponse<{ name: string }>(response);
  if (!token.name) throw new Error('Голосовая связь недоступна. Попробуйте ещё раз.');
  return token.name;
}

export async function sendAudio(sessionId: string, audio: Blob): Promise<TurnResponse> {
  const contentType = audio.type.split(';')[0] || 'audio/webm';
  const response = await fetch(BASE + '/sessions/' + sessionId + '/turns/audio', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: audio,
  });
  return readResponse<TurnResponse>(response);
}

export function audioUrl(path: string): string {
  if (!path.startsWith('/audio/')) throw new Error('Сервер вернул неверный адрес аудио');
  return BASE + path;
}
