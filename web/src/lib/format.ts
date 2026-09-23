import type { ActionType, Lang } from '../api/types';
import type { Message } from '../state/types';

export const ROUTE_TARGET_MS = 500;
export const E2E_TARGET_MS = 1500;
export const LOW_CONFIDENCE = 0.6;

export const ms = (v?: number | null) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} с` : `${Math.round(v)} мс`);
export const pct = (v: number) => `${Math.round(v * 100)}%`;

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${word}`;
}

export const LANG_LABEL: Record<Lang, string> = { ru: 'Русский', kk: 'Қазақша', mixed: 'Смешанная речь' };
export const LANG_SHORT: Record<Lang, string> = { ru: 'RU', kk: 'KZ', mixed: 'RU+KZ' };

export const ACTION_LABEL: Record<ActionType, string> = {
  answer: 'Ответ',
  clarify: 'Уточнение',
  confirm: 'Ждёт подтверждения',
  handoff: 'Передача оператору',
};

export type StageKey = 'stt' | 'route' | 'llm' | 'net' | 'tts';

export interface Stage {
  key: StageKey;
  label: string;
  ms: number;
}

export function stagesOf(m: Message): Stage[] {
  const t = m.turn?.timings;
  const c = m.client ?? {};
  const out: Stage[] = [];
  const stt = c.stt_ms ?? t?.stt_ms;
  if (stt != null) out.push({ key: 'stt', label: 'Распознавание', ms: stt });
  if (t) {
    out.push({ key: 'route', label: 'Выбор сценария', ms: t.route_ms });
    if (t.llm_ms != null) out.push({ key: 'llm', label: 'Генерация ответа', ms: t.llm_ms });
    if (c.network_ms != null) out.push({ key: 'net', label: 'Сеть и прочее', ms: Math.max(0, c.network_ms - t.route_ms - (t.llm_ms ?? 0)) });
  }
  const tts = c.tts_ms ?? t?.tts_ms;
  if (tts != null) out.push({ key: 'tts', label: 'Синтез речи', ms: tts });
  return out;
}

export function quantile(values: number[], q: number) {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[i];
}

export function relTime(ts: number) {
  const d = Date.now() - ts;
  if (d < 60_000) return 'только что';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} мин назад`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} ч назад`;
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
