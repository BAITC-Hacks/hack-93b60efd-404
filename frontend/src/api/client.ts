import type { Health, SttResponse, TurnRequest, TurnResponse } from './types';
import { mockTurn } from './mock';

const BASE = import.meta.env.VITE_API_BASE ?? '/api';

export type Source = 'backend' | 'mock';

export async function fetchHealth(): Promise<Health | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const r = await fetch(`${BASE}/health`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const body = (await r.json()) as Health;
    return body.ok ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendTurn(
  req: TurnRequest,
  source: Source,
): Promise<{ res: TurnResponse; network_ms: number }> {
  const t0 = performance.now();
  if (source === 'mock') {
    const res = await mockTurn(req);
    return { res, network_ms: performance.now() - t0 };
  }
  const r = await fetch(`${BASE}/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Сервер ответил ${r.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  const res = (await r.json()) as TurnResponse;
  return { res, network_ms: performance.now() - t0 };
}

export async function transcribe(audio: Blob, langHint: string): Promise<SttResponse> {
  const form = new FormData();
  form.append('audio', audio, 'utterance.webm');
  form.append('lang_hint', langHint);
  const r = await fetch(`${BASE}/stt`, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`Распознавание на сервере не удалось (${r.status})`);
  return (await r.json()) as SttResponse;
}
