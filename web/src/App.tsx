import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchHealth, sendTurn, type Source } from './api/client';
import type { Health, InputChannel, LangHint } from './api/types';
import { EmptyState, MessageList } from './components/Chat';
import { Composer } from './components/Composer';
import { Sidebar } from './components/Sidebar';
import { Supervisor } from './components/Supervisor';
import { TracePanel } from './components/TracePanel';
import { VoiceOrb, type OrbState } from './components/VoiceOrb';
import { CloudCanvas } from './components/CloudCanvas';
import { PHONE_H, PHONE_W, StatusBar, usePhoneFrame } from './components/PhoneFrame';
import { IconAlert, IconBolt, IconBranch, IconClose, IconMenu, IconRefresh, IconSliders, HalykLogo, HalykMark } from './components/icons';
import { LOW_CONFIDENCE, ms, pct } from './lib/format';
import { uid, useConversations } from './state/useConversations';
import type { ClientTimings, Review } from './state/types';
import { onSpeakingChange, speak, stopSpeaking } from './voice/tts';
import { useVoiceInput, type FinalUtterance, type SttEngine } from './voice/useVoiceInput';

const HISTORY_LIMIT = 20;

const LANGS: { id: LangHint; label: string }[] = [
  { id: 'auto', label: 'Авто' },
  { id: 'ru', label: 'RU' },
  { id: 'kk', label: 'KZ' },
];

export default function App() {
  const store = useConversations();
  const [view, setView] = useState<'chat' | 'supervisor'>('chat');
  const [mode, setMode] = useState<'voice' | 'chat'>('voice');
  const [session, setSession] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
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

  useEffect(() => onSpeakingChange(setSpeaking), []);

  const handleTurn = useCallback(
    async (text: string, input: InputChannel, utterance?: FinalUtterance) => {
      const startedAt = utterance?.speechEndedAt ?? performance.now();
      const convId = store.activeId ?? store.create();
      const prior = store.active?.id === convId ? store.active.messages : [];
      const history = prior
        .filter((m) => !m.pending && !m.error && m.text)
        .slice(-HISTORY_LIMIT)
        .map((m) => ({ role: m.role, text: m.text, scenario_id: m.turn?.scenario.id }));
      const withVoice = voiceOut || mode === 'voice';

      stopSpeaking();
      store.append(convId, { id: uid(), role: 'user', text, input, createdAt: Date.now() });
      const botId = uid();
      store.append(convId, { id: botId, role: 'assistant', text: '', pending: true, createdAt: Date.now() });
      setSelectedId(botId);
      setView('chat');
      setBusy(true);

      try {
        const { res, network_ms } = await sendTurn(
          { session_id: convId, text, input, lang_hint: langHint, history, stt_ms: utterance?.stt_ms, want_audio: withVoice },
          source,
        );
        const receivedAt = performance.now();
        const client: ClientTimings = { stt_ms: utterance?.stt_ms, network_ms };
        store.patch(convId, botId, { pending: false, text: res.reply_text, turn: res, client, source });
        setBusy(false);

        if (withVoice) {
          const audio = res.audio_b64 ? { b64: res.audio_b64, mime: res.audio_mime } : undefined;
          const audioAt = await speak(res.reply_text, res.lang === 'kk' ? 'kk' : 'ru', audio);
          if (audioAt != null) {
            store.patch(convId, botId, { client: { ...client, tts_ms: audioAt - receivedAt, e2e_ms: audioAt - startedAt } });
          }
        }
        if (res.action === 'handoff') setSession(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Запрос не выполнен';
        store.patch(convId, botId, { pending: false, error: `${msg}. Попробуйте ещё раз.` });
        setBusy(false);
      }
    },
    [langHint, mode, source, store, voiceOut],
  );

  const voice = useVoiceInput({
    engine,
    lang: langHint === 'kk' ? 'kk-KZ' : 'ru-RU',
    onFinal: (u) => void handleTurn(u.text, 'voice', u),
  });

  useEffect(() => {
    if (!session || muted || busy || speaking || voice.state !== 'idle' || voice.error) return;
    const t = setTimeout(() => void voice.start(), 350);
    return () => clearTimeout(t);
    // voice.start is recreated every render; the listed state is what matters
  }, [session, muted, busy, speaking, voice.state, voice.error]);

  const startVoiceMode = () => {
    stopSpeaking();
    setView('chat');
    setMode('voice');
    setMuted(false);
    setSession(true);
    if (voice.state === 'idle') void voice.start();
  };

  const endVoiceMode = () => {
    setSession(false);
    voice.cancel();
    stopSpeaking();
    setMode('chat');
  };

  const toggleMute = () => {
    if (!session) return startVoiceMode();
    if (!muted) voice.cancel();
    setMuted((v) => !v);
  };

  const onOrbClick = () => {
    if (speaking) return stopSpeaking();
    if (!session || muted) return startVoiceMode();
    if (voice.state === 'listening') voice.stop();
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
  const selectedIdx = selected ? messages.indexOf(selected) : -1;
  const selectedUser = selectedIdx > 0 ? [...messages.slice(0, selectedIdx)].reverse().find((m) => m.role === 'user') ?? null : null;
  const turnNo = selected ? botMessages.indexOf(selected) + 1 : 0;
  const lastBot = botMessages[botMessages.length - 1];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');

  const onReview = (r: Review | undefined) => {
    if (store.activeId && selected) store.patch(store.activeId, selected.id, { review: r });
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
    voice.state === 'listening'
      ? 'listening'
      : voice.state === 'processing' || busy
        ? 'thinking'
        : speaking
          ? 'speaking'
          : session && muted
            ? 'muted'
            : 'idle';

  const caption = (() => {
    if (orbState === 'listening') return voice.interim || 'Слушаю…';
    if (voice.state === 'processing') return 'Распознаю речь…';
    if (busy) return 'Выбираю сценарий…';
    if (speaking) return lastBot?.text.replace(/^\[демо\]\s*/, '') ?? '';
    if (session && muted) return 'Микрофон выключен';
    if (session) return '';
    return voice.supported ? 'Нажмите на шар и расскажите, что случилось' : 'Этот браузер не распознаёт речь. Откройте Chrome или напишите текстом';
  })();

  const supervisorOpen = view === 'supervisor';
  const showTrace = traceOpen && !supervisorOpen;
  const panelWidth = showTrace ? 400 : supervisorOpen ? 640 : 0;
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
              <div className="seg" role="radiogroup" aria-label="Язык распознавания">
                {LANGS.map((l) => (
                  <button key={l.id} role="radio" aria-checked={langHint === l.id} className={langHint === l.id ? 'is-on' : ''} onClick={() => setLangHint(l.id)}>
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="settings__row">
              <span>Озвучивать ответы в чате</span>
              <input type="checkbox" className="switch" checked={voiceOut} onChange={(e) => setVoiceOut(e.target.checked)} />
            </label>
            {health?.stt && (
              <label className="settings__row">
                <span>Распознавание</span>
                <select className="select" value={engine} onChange={(e) => setEngine(e.target.value as SttEngine)}>
                  <option value="server">на сервере</option>
                  <option value="browser">в браузере</option>
                </select>
              </label>
            )}
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
          {!checking && !health && (
            <span className="demo-pill" title="Сервер маршрутизации недоступен. Ответы даёт заглушка по ключевым словам, качество маршрутизации по ней не оценивайте.">
              Демо<span className="demo-pill__long"> без сервера</span>
              <button onClick={checkHealth} aria-label="Проверить сервер снова">
                <IconRefresh width={13} height={13} />
              </button>
            </span>
          )}
          {health && <span className="live-pill">{health.model ?? 'сервер'}</span>}
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
              <VoiceOrb state={orbState} levelRef={voice.levelRef} onClick={onOrbClick} label={session ? 'Закончить фразу' : 'Начать разговор'} />
              <div className="stage__caption" aria-live="polite">
                {orbState === 'speaking' && lastUser && <span className="stage__heard">«{lastUser.text}»</span>}
                <span className={orbState === 'listening' && voice.interim ? 'is-live' : ''}>{caption}</span>
              </div>
              {lastBot?.turn && !busy && (
                <button
                  className="route-pill"
                  onClick={() => {
                    setSelectedId(lastBot.id);
                    setTraceOpen(true);
                  }}
                  title="Открыть трассировку"
                >
                  {lastBot.turn.route_path === 'fast' ? <IconBolt width={13} height={13} /> : <IconBranch width={13} height={13} />}
                  <span className="route-pill__name">{lastBot.turn.scenario.name}</span>
                  <b className={lastBot.turn.scenario.confidence < LOW_CONFIDENCE ? 'warn' : ''}>{pct(lastBot.turn.scenario.confidence)}</b>
                  <span className="route-pill__ms">{ms(lastBot.turn.timings.route_ms)}</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="scroll">
            {messages.length === 0 ? (
              <EmptyState onExample={(t) => void handleTurn(t, 'text')} />
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
        )}

        {phoneView === 'chat' && voice.error && (
          <div className="toast" role="alert">
            <IconAlert width={16} height={16} />
            <span>{voice.error}</span>
            <button onClick={voice.clearError} aria-label="Закрыть">
              <IconClose width={14} height={14} />
            </button>
          </div>
        )}

        {phoneView === 'chat' && (
          <Composer
            mode={mode}
            busy={busy}
            voiceState={voice.state}
            interim={voice.interim}
            levelRef={voice.levelRef}
            micSupported={voice.supported}
            muted={muted}
            session={session}
            onSend={(t) => void handleTurn(t, 'text')}
            onDictate={() => {
              stopSpeaking();
              void voice.start();
            }}
            onStopDictation={voice.stop}
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

        {showTrace && (
          <>
            {!frame.framed && <div className="trace-scrim" onClick={() => setTraceOpen(false)} aria-hidden />}
            <div className="side" style={frame.framed ? { height: phoneH } : undefined}>
              <TracePanel message={selected} userMessage={selectedUser} turnNo={turnNo} onClose={() => setTraceOpen(false)} onReview={onReview} />
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
