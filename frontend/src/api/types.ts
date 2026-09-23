export type InputChannel = 'voice' | 'text';
export type Language = 'ru' | 'kk';

export interface ScenarioRef {
  id: string;
  name: string;
  description: string;
  priority: string;
}

export interface ActionTrace {
  name?: string;
  status?: string;
  [key: string]: unknown;
}

export interface TurnTrace {
  transcript: string;
  selected_scenarios: string[];
  alternative_details: ScenarioRef[];
  reason: string;
  model: string;
  ambiguity_reviewed: boolean;
  is_continuation: boolean;
  router_ms: number;
  extractor_ms: number | null;
  response_ms: number;
  stt_ms: number | null;
  tts_generation_ms?: number;
  tts_first_audio_ms: number | null;
  server_total_ms: number;
  input_tokens: number;
  output_tokens: number;
  rejected_slots: unknown[];
  actions: ActionTrace[];
}

export interface TurnResponse {
  session_id: string;
  turn: number;
  answer_text: string;
  language: Language;
  route: string[];
  route_details: ScenarioRef[];
  active_scenario: string | null;
  pending_scenarios: string[];
  trace: TurnTrace;
  audio_url?: string;
  audio_content_type?: string;
}

export interface Health {
  status: 'process_running';
}
