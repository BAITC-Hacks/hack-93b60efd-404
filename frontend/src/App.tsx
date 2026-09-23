import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createSession, fetchHealth, sendText } from './api/client';
import type { Health, InputChannel } from './api/types';
import { EXAMPLES, EmptyState, MessageList } from './components/Chat';
import { Composer } from './components/Composer';
import { Sidebar } from './components/Sidebar';
import { Supervisor } from './components/Supervisor';
import { TracePanel } from './components/TracePanel';
import { VoiceOrb, type OrbState } from './components/VoiceOrb';
import { CloudCanvas } from './components/CloudCanvas';
import { PHONE_H, PHONE_W, StatusBar, usePhoneFrame } from './components/PhoneFrame';
import { IconAlert, IconBranch, IconClose, IconMenu, IconSliders, HalykLogo, HalykMark } from './components/icons';
import { ms } from './lib/format';
import { uid, useConversations } from './state/useConversations';
import type { ClientTimings, Review } from './state/types';
import { onSpeakingChange, speak, stopSpeaking } from './voice/tts';
import { useGeminiLive } from './voice/useGeminiLive';

function extendTranscript(current: string, incoming: string): string {
  if (!current) return incoming;
  if (incoming.startsWith(current)) return incoming;
  if (current.endsWith(incoming)) return current;
  return current + incoming;
}

export default function App() {
  const store = useConversations();
  const [view, setView] = useState<'chat' | 'supervisor'>('chat');
  const [mode, setMode] = useState<'voice' | 'chat'>('voice');
  const [session, setSession] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(() => window.innerWidth >= 1100 && window.innerHeight >= 620);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const [voiceOut, setVoiceOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const liveConvRef = useRef<string | null>(null);
  const liveBackendRef = useRef<string | null>(null);
  const liveTurnRef = useRef<{ userId: string | null; botId: string; input: string; output: string; inputFinished: boolean } | null>(null);
  const liveCallsRef = useRef(new Map<string, { convId: string; botId: string }>());
  const startingRef = useRef(false);

  useEffect(() => {
    void fetchHealth().then(setHealth).catch(() =>
      setAppError('Бэкенд недоступен. Запустите сервер и обновите страницу.')
    );
  }, []);

  useEffect(() => onSpeakingChange(setSpeaking), []);

  const handleTurn = useCallback(
    async (text: string, input: InputChannel) => {
      if (busyRef.current || !health) return;
      busyRef.current = true;
      setBusy(true);
      setAppError(null);
      const startedAt = performance.now();
      const convId = store.activeId ?? store.create();
      const withVoice = voiceOut;

      stopSpeaking();
      const userId = uid();
      store.append(convId, {
        id: userId, role: 'user', text,
        input, createdAt: Date.now(),
      });
      const botId = uid();
      store.append(convId, { id: botId, role: 'assistant', text: '', pending: true, createdAt: Date.now() });
      setSelectedId(botId);
      setView('chat');

      try {
        let backendId = store.active?.backendSessionId;
        if (!backendId) {
          backendId = await createSession();
          store.setBackendSession(convId, backendId);
        }
        const requestAt = performance.now();
        const res = await sendText(backendId, text, withVoice);
        const client: ClientTimings = { network_ms: performance.now() - requestAt };
        store.patch(convId, botId, { pending: false, text: res.answer_text, turn: res, client });
        busyRef.current = false;
        setBusy(false);
        if (withVoice) {
          if (!res.audio_url) throw new Error('Сервер не вернул голосовой ответ');
          const audioAt = await speak(res.audio_url);
          if (audioAt != null) {
            store.patch(convId, botId, { client: { ...client, e2e_ms: audioAt - startedAt } });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Запрос не выполнен';
        store.patch(convId, botId, { pending: false, error: msg });
        setAppError(msg);
        busyRef.current = false;
        setBusy(false);
      }
    },
    [health, store, voiceOut],
  );

  const createLiveTurn = (text: string, finished: boolean) => {
    const convId = liveConvRef.current;
    if (!convId) return null;
    const userId = text ? uid() : null;
    if (userId) store.append(convId, { id: userId, role: 'user', text, input: 'voice', createdAt: Date.now() });
    const botId = uid();
    store.append(convId, { id: botId, role: 'assistant', text: '', pending: true, createdAt: Date.now() });
    const turn = { userId, botId, input: text, output: '', inputFinished: finished };
    liveTurnRef.current = turn;
    setSelectedId(botId);
    return turn;
  };

  const voice = useGeminiLive({
    onInput: (text, finished) => {
      const convId = liveConvRef.current;
      if (!convId) return;
      let turn = liveTurnRef.current;
      if (turn?.inputFinished && (turn.input === text || turn.input.includes(text))) return;
      if (!turn || turn.inputFinished) turn = createLiveTurn(text, finished);
      else if (turn) {
        turn.input = extendTranscript(turn.input, text);
        turn.inputFinished = finished;
        if (turn.userId) store.patch(convId, turn.userId, { text: turn.input });
        else {
          turn.userId = uid();
          store.append(convId, { id: turn.userId, role: 'user', text: turn.input, input: 'voice', createdAt: Date.now() });
        }
      }
    },
    onOutput: (text) => {
      const convId = liveConvRef.current;
      if (!convId) return;
      const turn = liveTurnRef.current ?? createLiveTurn('', false);
      if (!turn) return;
      turn.output = extendTranscript(turn.output, text);
      store.patch(convId, turn.botId, { text: turn.output, pending: false });
    },
    onTool: (text, signal, callId) => {
      const convId = liveConvRef.current;
      const backendId = liveBackendRef.current;
      if (!convId || !backendId) throw new Error('Сессия бэкенда не готова');
      let turn = liveTurnRef.current;
      if (!turn || (turn.inputFinished && !turn.input.includes(text) && !text.includes(turn.input))) {
        turn = createLiveTurn(text, true);
      }
      if (turn) liveCallsRef.current.set(callId, { convId, botId: turn.botId });
      return sendText(backendId, text, false, signal);
    },
    onRoute: (result, request, callId) => {
      const target = liveCallsRef.current.get(callId);
      liveCallsRef.current.delete(callId);
      if (!target) return;
      const turn = liveTurnRef.current;
      const output = turn?.botId === target.botId ? turn.output : '';
      store.patch(target.convId, target.botId, {
        pending: false,
        text: output || result.answer_text,
        turn: result,
      });
      if (turn?.botId === target.botId && !turn.userId) {
        turn.userId = uid();
        store.append(target.convId, { id: turn.userId, role: 'user', text: request, input: 'voice', createdAt: Date.now() });
      }
    },
  });

  useEffect(() => { if (voice.error) setSession(false); }, [voice.error]);

  const startVoiceMode = async () => {
    if (!health || startingRef.current || session) return;
    startingRef.current = true;
    stopSpeaking();
    setView('chat');
    setMode('voice');
    setMuted(false);
    setAppError(null);
    try {
      const convId = store.activeId ?? store.create();
      let backendId = store.active?.backendSessionId;
      if (!backendId) {
        backendId = await createSession();
        store.setBackendSession(convId, backendId);
      }
      liveConvRef.current = convId;
      liveBackendRef.current = backendId;
      liveTurnRef.current = null;
      setSession(true);
      await voice.start();
    } catch (cause) {
      setSession(false);
      setAppError(cause instanceof Error ? cause.message : 'Не удалось начать разговор');
    } finally {
      startingRef.current = false;
    }
  };

  const endVoiceMode = () => {
    setSession(false);
    voice.stop();
    liveConvRef.current = null;
    liveBackendRef.current = null;
    liveTurnRef.current = null;
    liveCallsRef.current.clear();
    stopSpeaking();
    setMode('chat');
  };

  const toggleMute = () => {
    if (!session) return void startVoiceMode();
    voice.setMuted(!muted);
    setMuted(!muted);
  };

  const onOrbClick = () => {
    if (!session) void startVoiceMode();
    else endVoiceMode();
  };

  const sendUserText = (text: string) => {
    if (!session) {
      void handleTurn(text, 'text');
      return;
    }
    if (voice.state === 'connecting' || voice.state === 'idle') {
      setAppError('Голосовое соединение ещё не готово');
      return;
    }
    createLiveTurn(text, true);
    try { voice.sendText(text); }
    catch (cause) { setAppError(cause instanceof Error ? cause.message : 'Не удалось отправить текст'); }
  };

  const newConversation = () => {
    endVoiceMode();
    store.setActiveId(null);
    setSelectedId(null);
    setView('chat');
    setMode('voice');
    setDrawerOpen(false);
  };

  const messages = store.active?.messages ?? [];
  const botMessages = useMemo(() => messages.filter((m) => m.role === 'assistant'), [messages]);
  const selected = botMessages.find((m) => m.id === selectedId) ?? botMessages[botMessages.length - 1] ?? null;
  const lastBot = botMessages[botMessages.length - 1];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');

  const onReview = (id: string, r: Review | undefined) => {
    if (store.activeId) store.patch(store.activeId, id, { review: r });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (traceOpen) setTraceOpen(false);
      else if (drawerOpen) setDrawerOpen(false);
      else stopSpeaking();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [traceOpen, drawerOpen]);

  const orbState: OrbState =
    voice.state === 'connecting' || voice.state === 'processing' || busy
        ? 'thinking'
        : voice.state === 'speaking' || speaking
          ? 'speaking'
          : session && muted
            ? 'muted'
          : voice.state === 'listening'
            ? 'listening'
            : 'idle';

  const caption = (() => {
    if (voice.state === 'connecting') return 'Подключаю голосовой разговор…';
    if (voice.state === 'processing') return 'Проверяю данные…';
    if (busy) return 'Выбираю сценарий…';
    if (voice.state === 'speaking' || speaking) return lastBot?.text ?? '';
    if (session && muted) return 'Микрофон выключен';
    if (session) return 'Слушаю…';
    if (!health) return 'Ожидание подключения к серверу';
    return voice.supported ? 'Нажмите на шар и расскажите, что случилось' : 'Этот браузер не умеет записывать звук. Используйте текстовый ввод.';
  })();

  const supervisorOpen = view === 'supervisor';
  const showTrace = traceOpen && !supervisorOpen;
  const [traceLeaving, setTraceLeaving] = useState(false);
  const traceWasShown = useRef(showTrace);
  useLayoutEffect(() => {
    const was = traceWasShown.current;
    traceWasShown.current = showTrace;
    if (!was || showTrace || supervisorOpen) return setTraceLeaving(false);
    setTraceLeaving(true);
    const t = setTimeout(() => setTraceLeaving(false), 220);
    return () => clearTimeout(t);
  }, [showTrace, supervisorOpen]);
  const traceMounted = showTrace || traceLeaving;
  const panelWidth = traceMounted ? 400 : supervisorOpen ? 640 : 0;
  const frame = usePhoneFrame(panelWidth);
  const phoneView = frame.framed ? 'chat' : view;
  const phoneH = PHONE_H * frame.scale;

  const supervisor = (
    <Supervisor
      conversations={store.conversations}
      onClearAll={store.clearAll}
      onOpen={(convId, msgId) => {
        store.setActiveId(convId);
        setSelectedId(msgId);
        setTraceOpen(true);
        setMode('chat');
        setView('chat');
      }}
    />
  );

  return (
    <div className={`shell ${frame.framed ? 'is-framed' : ''}`}>
      {frame.framed && <CloudCanvas variant="sky" className="shell__sky" resolution={0.35} />}
      {frame.framed && <HalykLogo height={34} className="shell__brand" />}
      <div className="shell__row">
        <div className="phone-slot" style={frame.framed ? { width: PHONE_W * frame.scale, height: phoneH } : undefined}>
          <div className="phone" style={frame.framed ? { transform: `scale(${frame.scale})` } : undefined}>
          <div className="phone__screen">
            {frame.framed && <StatusBar />}
    <div className="app">
      <Sidebar
        conversations={store.conversations}
        activeId={store.activeId}
        view={view}
        open={drawerOpen}
        onNew={newConversation}
        onSelect={(id) => {
          endVoiceMode();
          store.setActiveId(id);
          setSelectedId(null);
          setView('chat');
          setDrawerOpen(false);
        }}
        onDelete={store.remove}
        onView={(v) => {
          if (v === 'supervisor' && !frame.framed) endVoiceMode();
          setView(v);
          setDrawerOpen(false);
        }}
        onClose={() => setDrawerOpen(false)}
        settings={
          <>
            <div className="settings__row">
              <span>Язык речи</span>
              <span>Русский / қазақша — автоматически</span>
            </div>
            <label className="settings__row">
              <span>Озвучивать ответы в чате</span>
              <input type="checkbox" className="switch" checked={voiceOut} onChange={(e) => setVoiceOut(e.target.checked)} />
            </label>
            <div className="settings__row">
              <span>Голос</span>
              <span>Синтезирован ИИ</span>
            </div>
          </>
        }
      />

      <main className="main">
        <header className="topbar">
          <button className="chip-btn round-sm" onClick={() => setDrawerOpen(true)} aria-label="Разговоры и настройки">
            <IconMenu width={18} height={18} />
          </button>
          <button className="chip-btn title-pill" onClick={() => (phoneView === 'supervisor' ? setView('chat') : setDrawerOpen(true))}>
            <HalykMark size={18} className="brand-logo" />
            {phoneView === 'supervisor' ? 'Супервизор' : 'Voice Router'}
          </button>
          {health && <span className="live-pill">сервер подключён</span>}
          <div className="topbar__spacer" />
          {phoneView === 'chat' && (
            <button
              className={`chip-btn round-sm ${showTrace ? 'is-on' : ''}`}
              onClick={() => {
                if (supervisorOpen) {
                  setView('chat');
                  setTraceOpen(true);
                } else setTraceOpen((v) => !v);
              }}
              aria-pressed={traceOpen}
              aria-label="Трассировка"
              title="Трассировка: сценарий, обоснование, задержки"
            >
              <IconSliders width={18} height={18} />
            </button>
          )}
        </header>

        {phoneView === 'supervisor' ? (
          <div className="scroll">{supervisor}</div>
        ) : mode === 'voice' ? (
          <div className="stage">
            <div className="stage__center">
              <VoiceOrb state={orbState} levelRef={voice.levelRef} onClick={onOrbClick} label={session ? 'Завершить разговор' : 'Начать разговор'} />
              <div className="stage__caption" aria-live="polite">
                {orbState === 'speaking' && lastUser && <span className="stage__heard">«{lastUser.text}»</span>}
                <span key={orbState === 'listening' ? 'listening' : caption}>
                  {caption}
                </span>
              </div>
              {!session && !lastBot && !busy && (
                <div className="hints">
                  {EXAMPLES.filter((e) => e.short).map((e) => (
                    <button key={e.text} className="hint" onClick={() => sendUserText(e.text)}>
                      <span className="hint__lang">{e.lang}</span>
                      {e.short}
                    </button>
                  ))}
                </div>
              )}
              {lastBot?.turn && !busy && (
                <button
                  className="route-pill"
                  onClick={() => {
                    setSelectedId(lastBot.id);
                    setTraceOpen(true);
                  }}
                  title="Открыть трассировку"
                >
                  <IconBranch width={13} height={13} />
                  <span className="route-pill__name">{lastBot.turn.route_details.map((route) => route.name).join(' + ')}</span>
                  <span className="route-pill__ms">{ms(lastBot.turn.trace.router_ms)}</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="scroll">
            {messages.length === 0 ? (
              <EmptyState onExample={sendUserText} />
            ) : (
              <MessageList
                messages={messages}
                busy={busy}
                onConfirm={(yes) => sendUserText(yes ? 'Да, подтверждаю' : 'Нет, не нужно')}
              />
            )}
          </div>
        )}

        {phoneView === 'chat' && (voice.error || appError) && (
          <div className="toast" role="alert">
            <IconAlert width={16} height={16} />
            <span>{voice.error || appError}</span>
            <button onClick={() => {
              voice.clearError();
              setAppError(null);
              if (!health) void fetchHealth().then(setHealth).catch(() =>
                setAppError('Бэкенд недоступен. Запустите сервер и повторите попытку.'));
            }} aria-label={health ? 'Закрыть' : 'Повторить подключение'}>
              <IconClose width={14} height={14} />
            </button>
          </div>
        )}

        {phoneView === 'chat' && (
          <Composer
            mode={mode}
            busy={busy || !health}
            voiceState={voice.state}
            interim=""
            levelRef={voice.levelRef}
            micSupported={voice.supported && !!health}
            muted={muted}
            session={session}
            onSend={sendUserText}
            onDictate={() => {
              stopSpeaking();
              void startVoiceMode();
            }}
            onStopDictation={endVoiceMode}
            onToggleMute={toggleMute}
            onStartVoice={startVoiceMode}
            onEndVoice={endVoiceMode}
          />
        )}
      </main>
    </div>
          </div>
          </div>
        </div>

        {traceMounted && (
          <>
            {!frame.framed && <div className={`trace-scrim ${showTrace ? '' : 'is-closing'}`} onClick={() => setTraceOpen(false)} aria-hidden />}
            <div className={`side ${showTrace ? '' : 'is-closing'}`} style={frame.framed ? { height: phoneH } : undefined}>
              <TracePanel
                messages={messages}
                selectedId={selected?.id ?? null}
                onSelect={setSelectedId}
                onClose={() => setTraceOpen(false)}
                onReview={onReview}
              />
            </div>
          </>
        )}

        {frame.framed && supervisorOpen && (
          <div className="side side--wide" style={{ height: phoneH }}>
            <button className="iconbtn side__close" onClick={() => setView('chat')} aria-label="Закрыть панель супервизора">
              <IconClose />
            </button>
            <div className="side__scroll">{supervisor}</div>
          </div>
        )}
      </div>
    </div>
  );
}
