import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchHealth, sendTurn, type Source } from './api/client';
import type { Health, InputChannel, LangHint } from './api/types';
import { EmptyState, MessageList } from './components/Chat';
import { Composer } from './components/Composer';
import { Sidebar } from './components/Sidebar';
import { Supervisor } from './components/Supervisor';
import { TracePanel } from './components/TracePanel';
import { IconAlert, IconClose, IconRefresh, IconSidebar, IconSpeaker, IconSpeakerOff, IconTrace } from './components/icons';
import { uid, useConversations } from './state/useConversations';
import type { ClientTimings, Review } from './state/types';
import { speak, stopSpeaking } from './voice/tts';
import { useVoiceInput, type FinalUtterance, type SttEngine } from './voice/useVoiceInput';

const HISTORY_LIMIT = 20;

export default function App() {
  const store = useConversations();
  const [view, setView] = useState<'chat' | 'supervisor'>('chat');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [traceOpen, setTraceOpen] = useState(() => window.innerWidth >= 1200);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(true);
  const [langHint, setLangHint] = useState<LangHint>('auto');
  const [voiceOut, setVoiceOut] = useState(true);
  const [engine, setEngine] = useState<SttEngine>('browser');
  const [busy, setBusy] = useState(false);

  const source: Source = health ? 'backend' : 'mock';

  const checkHealth = useCallback(async () => {
    setChecking(true);
    const h = await fetchHealth();
    setHealth(h);
    if (h?.stt) setEngine('server');
    setChecking(false);
  }, []);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  const handleTurn = useCallback(
    async (text: string, input: InputChannel, utterance?: FinalUtterance) => {
      const startedAt = utterance?.speechEndedAt ?? performance.now();
      const convId = store.activeId ?? store.create();
      const prior = store.active?.id === convId ? store.active.messages : [];
      const history = prior
        .filter((m) => !m.pending && !m.error && m.text)
        .slice(-HISTORY_LIMIT)
        .map((m) => ({ role: m.role, text: m.text, scenario_id: m.turn?.scenario.id }));

      stopSpeaking();
      store.append(convId, { id: uid(), role: 'user', text, input, createdAt: Date.now() });
      const botId = uid();
      store.append(convId, { id: botId, role: 'assistant', text: '', pending: true, createdAt: Date.now() });
      setSelectedId(botId);
      setView('chat');
      setBusy(true);

      try {
        const { res, network_ms } = await sendTurn(
          { session_id: convId, text, input, lang_hint: langHint, history, stt_ms: utterance?.stt_ms, want_audio: voiceOut },
          source,
        );
        const receivedAt = performance.now();
        const client: ClientTimings = { stt_ms: utterance?.stt_ms, network_ms };
        store.patch(convId, botId, { pending: false, text: res.reply_text, turn: res, client, source });
        setBusy(false);

        if (voiceOut) {
          const audio = res.audio_b64 ? { b64: res.audio_b64, mime: res.audio_mime } : undefined;
          const audioAt = await speak(res.reply_text, res.lang === 'kk' ? 'kk' : 'ru', audio);
          if (audioAt != null) {
            store.patch(convId, botId, { client: { ...client, tts_ms: audioAt - receivedAt, e2e_ms: audioAt - startedAt } });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Запрос не выполнен';
        store.patch(convId, botId, { pending: false, error: `${msg}. Попробуйте ещё раз.` });
        setBusy(false);
      }
    },
    [langHint, source, store, voiceOut],
  );

  const voice = useVoiceInput({
    engine,
    lang: langHint === 'kk' ? 'kk-KZ' : 'ru-RU',
    onFinal: (u) => void handleTurn(u.text, 'voice', u),
  });

  const startMic = () => {
    stopSpeaking();
    void voice.start();
  };

  const newConversation = () => {
    stopSpeaking();
    store.setActiveId(null);
    setSelectedId(null);
    setView('chat');
    setDrawerOpen(false);
  };

  const messages = store.active?.messages ?? [];
  const botMessages = useMemo(() => messages.filter((m) => m.role === 'assistant'), [messages]);
  const selected = botMessages.find((m) => m.id === selectedId) ?? botMessages[botMessages.length - 1] ?? null;
  const selectedIdx = selected ? messages.indexOf(selected) : -1;
  const selectedUser = selectedIdx > 0 ? [...messages.slice(0, selectedIdx)].reverse().find((m) => m.role === 'user') ?? null : null;
  const turnNo = selected ? botMessages.indexOf(selected) + 1 : 0;

  const onReview = (r: Review | undefined) => {
    if (store.activeId && selected) store.patch(store.activeId, selected.id, { review: r });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopSpeaking();
        if (voice.state === 'listening') voice.stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voice]);

  const error = voice.error;

  return (
    <div className={`app ${sidebarHidden ? 'no-sidebar' : ''} ${traceOpen && view === 'chat' ? 'with-trace' : ''}`}>
      <Sidebar
        conversations={store.conversations}
        activeId={store.activeId}
        view={view}
        open={drawerOpen}
        onNew={newConversation}
        onSelect={(id) => {
          stopSpeaking();
          store.setActiveId(id);
          setSelectedId(null);
          setView('chat');
          setDrawerOpen(false);
        }}
        onDelete={store.remove}
        onView={(v) => {
          setView(v);
          setDrawerOpen(false);
        }}
        onClose={() => setDrawerOpen(false)}
      />

      <main className="main">
        <header className="topbar">
          <button
            className="iconbtn"
            onClick={() => (window.innerWidth < 900 ? setDrawerOpen(true) : setSidebarHidden((v) => !v))}
            aria-label="Показать или скрыть список разговоров"
          >
            <IconSidebar />
          </button>
          <div className="topbar__title">{view === 'supervisor' ? 'Панель супервизора' : store.active?.title ?? 'Новый разговор'}</div>

          <div className="topbar__right">
            <span className={`status ${checking ? '' : health ? 'status--ok' : 'status--demo'}`}>
              <i />
              {checking ? 'Проверяю сервер…' : health ? `Сервер${health.model ? ` · ${health.model}` : ''}` : 'Демо без сервера'}
              {!checking && !health && (
                <button onClick={checkHealth} aria-label="Проверить сервер снова" title="Проверить сервер снова">
                  <IconRefresh width={14} height={14} />
                </button>
              )}
            </span>
            {health?.stt && (
              <select className="select" value={engine} onChange={(e) => setEngine(e.target.value as SttEngine)} aria-label="Распознавание речи">
                <option value="server">Распознавание: сервер</option>
                <option value="browser">Распознавание: браузер</option>
              </select>
            )}
            <button
              className={`iconbtn ${voiceOut ? '' : 'is-off'}`}
              onClick={() => {
                if (voiceOut) stopSpeaking();
                setVoiceOut((v) => !v);
              }}
              aria-pressed={voiceOut}
              aria-label={voiceOut ? 'Выключить голосовые ответы' : 'Включить голосовые ответы'}
              title={voiceOut ? 'Голосовые ответы включены' : 'Голосовые ответы выключены'}
            >
              {voiceOut ? <IconSpeaker /> : <IconSpeakerOff />}
            </button>
            {view === 'chat' && (
              <button
                className={`iconbtn ${traceOpen ? 'is-on' : ''}`}
                onClick={() => setTraceOpen((v) => !v)}
                aria-pressed={traceOpen}
                aria-label="Трассировка"
                title="Трассировка"
              >
                <IconTrace />
              </button>
            )}
          </div>
        </header>

        {!checking && !health && view === 'chat' && (
          <div className="banner">
            Сервер маршрутизации недоступен, ответы даёт упрощённая заглушка по ключевым словам. Качество маршрутизации по ней не оценивайте.
          </div>
        )}

        {view === 'supervisor' ? (
          <div className="scroll">
            <Supervisor
              conversations={store.conversations}
              onClearAll={store.clearAll}
              onOpen={(convId, msgId) => {
                store.setActiveId(convId);
                setSelectedId(msgId);
                setTraceOpen(true);
                setView('chat');
              }}
            />
          </div>
        ) : (
          <>
            <div className="scroll">
              {messages.length === 0 ? (
                <EmptyState onExample={(t) => void handleTurn(t, 'text')} onMic={startMic} micSupported={voice.supported} />
              ) : (
                <MessageList
                  messages={messages}
                  selectedId={selected?.id ?? null}
                  busy={busy}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setTraceOpen(true);
                  }}
                  onConfirm={(yes) => void handleTurn(yes ? 'Да, подтверждаю' : 'Нет, не нужно', 'text')}
                />
              )}
            </div>

            {error && (
              <div className="toast" role="alert">
                <IconAlert width={16} height={16} />
                <span>{error}</span>
                <button onClick={voice.clearError} aria-label="Закрыть">
                  <IconClose width={14} height={14} />
                </button>
              </div>
            )}

            <Composer
              disabled={busy}
              voiceState={voice.state}
              interim={voice.interim}
              levelRef={voice.levelRef}
              micSupported={voice.supported}
              lang={langHint}
              onLang={setLangHint}
              onSend={(t) => void handleTurn(t, 'text')}
              onMic={startMic}
              onStopMic={voice.stop}
            />
          </>
        )}
      </main>

      {view === 'chat' && traceOpen && (
        <>
          <div className="trace-scrim" onClick={() => setTraceOpen(false)} aria-hidden />
          <TracePanel message={selected} userMessage={selectedUser} turnNo={turnNo} onClose={() => setTraceOpen(false)} onReview={onReview} />
        </>
      )}
    </div>
  );
}
