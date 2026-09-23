import type { InputChannel, TurnResponse } from '../api/types';

export interface ClientTimings {
  stt_ms?: number;
  network_ms?: number;
  tts_ms?: number;
  /** From the end of the client's speech (or pressing send) to the first sound of the answer. */
  e2e_ms?: number;
}

export interface Review {
  verdict: 'ok' | 'wrong';
  correct_scenario?: string;
  note?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  input?: InputChannel;
  pending?: boolean;
  error?: string;
  turn?: TurnResponse;
  client?: ClientTimings;
  review?: Review;
  source?: 'backend' | 'mock';
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}
