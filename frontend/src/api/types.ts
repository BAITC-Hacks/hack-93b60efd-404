export type Lang = 'ru' | 'kk' | 'mixed';
export type LangHint = 'ru' | 'kk' | 'auto';
export type RoutePath = 'fast' | 'llm';
export type ActionType = 'answer' | 'clarify' | 'confirm' | 'handoff';
export type InputChannel = 'voice' | 'text';

export interface ScenarioRef {
  id: string;
  name: string;
  confidence: number;
}

export interface Alternative extends ScenarioRef {
  why_not?: string;
}

export interface Timings {
  stt_ms?: number;
  route_ms: number;
  llm_ms?: number;
  tts_ms?: number;
  total_ms: number;
}

export type ParamValue = string | number | boolean | null;

export interface TurnResponse {
  reply_text: string;
  lang: Lang;
  scenario: ScenarioRef;
  reasoning: string;
  alternatives: Alternative[];
  route_path: RoutePath;
  action: ActionType;
  params: Record<string, ParamValue>;
  topic_stack?: string[];
  resumed_from?: string | null;
  emotion?: string | null;
  handoff_summary?: string | null;
  timings: Timings;
  audio_b64?: string | null;
  audio_mime?: string | null;
}

export interface HistoryItem {
  role: 'user' | 'assistant';
  text: string;
  scenario_id?: string;
}

export interface TurnRequest {
  session_id: string;
  text: string;
  input: InputChannel;
  lang_hint: LangHint;
  history: HistoryItem[];
  stt_ms?: number;
  want_audio: boolean;
}

export interface SttResponse {
  text: string;
  lang?: Lang;
  stt_ms?: number;
}

export interface Health {
  ok: boolean;
  model?: string;
  stt?: boolean;
  tts?: boolean;
  scenarios?: number;
}
