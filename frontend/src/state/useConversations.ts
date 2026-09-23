import { useCallback, useEffect, useState } from 'react';
import type { Conversation, Message } from './types';

const KEY = 'voice-router.conversations.v2';

export const uid = () => crypto.randomUUID();

function load(): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Conversation[];
    return list.map((c) => ({
      ...c,
      messages: c.messages.map((m) => (m.pending ? { ...m, pending: false, error: m.error ?? 'Ответ не получен' } : m)),
    }));
  } catch {
    return [];
  }
}

function titleFrom(text: string) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 48 ? `${t.slice(0, 46)}…` : t;
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>(load);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(conversations));
  }, [conversations]);

  const create = useCallback((): string => {
    const now = Date.now();
    const conv: Conversation = { id: uid(), title: 'Новый разговор', createdAt: now, updatedAt: now, messages: [] };
    setConversations((list) => [conv, ...list]);
    setActiveId(conv.id);
    return conv.id;
  }, []);

  const append = useCallback((convId: string, msg: Message) => {
    setConversations((list) =>
      list.map((c) => {
        if (c.id !== convId) return c;
        const first = msg.role === 'user' && !c.messages.some((m) => m.role === 'user');
        return {
          ...c,
          title: first ? titleFrom(msg.text) : c.title,
          updatedAt: Date.now(),
          messages: [...c.messages, msg],
        };
      }),
    );
  }, []);

  const setBackendSession = useCallback((convId: string, sessionId: string) => {
    setConversations((list) => list.map((c) => c.id === convId ? { ...c, backendSessionId: sessionId } : c));
  }, []);

  const patch = useCallback((convId: string, msgId: string, update: Partial<Message>) => {
    setConversations((list) =>
      list.map((c) =>
        c.id !== convId
          ? c
          : {
              ...c,
              title: update.text && c.messages.find((m) => m.role === 'user')?.id === msgId
                ? titleFrom(update.text) : c.title,
              messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...update } : m)),
            },
      ),
    );
  }, []);

  const remove = useCallback((convId: string) => {
    setConversations((list) => list.filter((c) => c.id !== convId));
    setActiveId((id) => (id === convId ? null : id));
  }, []);

  const clearAll = useCallback(() => {
    setConversations([]);
    setActiveId(null);
  }, []);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  return { conversations, active, activeId, setActiveId, create, setBackendSession, append, patch, remove, clearAll };
}
