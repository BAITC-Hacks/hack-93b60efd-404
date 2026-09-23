import type { Language, ScenarioRef } from '../api/types';
import type { Message } from '../state/types';

export const ROUTE_TARGET_MS = 500;
export const E2E_TARGET_MS = 1500;

export const ms = (value?: number | null) =>
  value == null ? '—' : value >= 1000 ? (value / 1000).toFixed(2) + ' с' : Math.round(value) + ' мс';
export const pct = (value: number) => Math.round(value * 100) + '%';

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return n + ' ' + word;
}

export const LANG_LABEL: Record<Language, string> = { ru: 'Русский', kk: 'Қазақша' };
export const LANG_SHORT: Record<Language, string> = { ru: 'RU', kk: 'KZ' };

export function scenarioLabel(route: ScenarioRef, language: Language): string {
  const system: Record<string, Record<Language, string>> = {
    SYS_UNCLEAR: { ru: 'Нужно уточнение', kk: 'Нақтылау қажет' },
    SYS_OUT_OF_SCOPE: { ru: 'Вне страховых услуг', kk: 'Сақтандыру қызметінен тыс' },
    SYS_GOODBYE: { ru: 'Завершение разговора', kk: 'Әңгіме аяқталды' },
  };
  return system[route.id]?.[language] ?? route.name;
}

export type StageKey = 'stt' | 'route' | 'llm' | 'net' | 'tts';

export interface Stage {
  key: StageKey;
  label: string;
  ms: number;
}

export function stagesOf(message: Message): Stage[] {
  const trace = message.turn?.trace;
  if (!trace) return [];
  const stages: Stage[] = [];
  if (trace.stt_ms != null) stages.push({ key: 'stt', label: 'Распознавание', ms: trace.stt_ms });
  stages.push({ key: 'route', label: 'Выбор сценария', ms: trace.router_ms });
  if (trace.extractor_ms != null || trace.response_ms) {
    stages.push({ key: 'llm', label: 'Параметры и ответ', ms: (trace.extractor_ms ?? 0) + trace.response_ms });
  }
  if (trace.tts_generation_ms != null) stages.push({ key: 'tts', label: 'Синтез речи', ms: trace.tts_generation_ms });
  const known = stages.reduce((sum, stage) => sum + stage.ms, 0);
  const other = Math.max(0, (message.client?.network_ms ?? trace.server_total_ms) - known);
  if (other > 1) stages.push({ key: 'net', label: 'Сеть и прочее', ms: other });
  return stages;
}

export function quantile(values: number[], q: number) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

export function relTime(timestamp: number) {
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return 'только что';
  if (elapsed < 3_600_000) return Math.floor(elapsed / 60_000) + ' мин назад';
  if (elapsed < 86_400_000) return Math.floor(elapsed / 3_600_000) + ' ч назад';
  return new Date(timestamp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
