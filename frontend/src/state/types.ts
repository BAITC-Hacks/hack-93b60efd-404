import type { InputChannel, TurnResponse } from '../api/types';

export interface ClientTimings {
  network_ms?: number;
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
}

export interface Conversation {
  id: string;
  backendSessionId?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}
