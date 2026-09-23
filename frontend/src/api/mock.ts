import type { ActionType, Alternative, Lang, ParamValue, TurnRequest, TurnResponse } from './types';

// Offline stand-in for the backend so the UI can be exercised without a server.
// It matches keywords and must never be presented as the routing layer.

interface MockScenario {
  id: string;
  name: string;
  keys: string[];
  reply: { ru: string; kk: string };
  action?: ActionType;
}

const SCENARIOS: MockScenario[] = [
  {
    id: 'payment_not_confirmed',
    name: 'Оплата прошла, полис не активирован',
    keys: ['оплатил', 'списал', 'не подтверд', 'не активир', 'төледім', 'ақша кетті'],
    reply: {
      ru: 'Вижу платёж, он ещё в обработке у банка. Полис активируется автоматически в течение часа — пришлю SMS, когда это случится.',
      kk: 'Төлем көрінеді, банкте өңделуде. Полис бір сағат ішінде автоматты түрде іске қосылады — SMS жіберемін.',
    },
  },
  {
    id: 'change_delivery_address',
    name: 'Изменение адреса доставки полиса',
    keys: ['адрес', 'доставк', 'мекенжай', 'жеткіз'],
    reply: {
      ru: 'Назовите новый адрес доставки: город, улицу и дом. Я повторю его перед сохранением.',
      kk: 'Жаңа жеткізу мекенжайын айтыңыз: қала, көше, үй. Сақтамас бұрын қайталаймын.',
    },
  },
  {
    id: 'claim_report',
    name: 'Заявить о страховом случае',
    keys: ['дтп', 'авари', 'страховой случай', 'затопил', 'украли', 'сақтандыру жағдай', 'апат'],
    reply: {
      ru: 'Сочувствую. Давайте оформим заявление: когда и где это произошло?',
      kk: 'Түсіністікпен қараймын. Өтінішті рәсімдейік: бұл қашан және қайда болды?',
    },
  },
  {
    id: 'claim_status',
    name: 'Статус страховой выплаты',
    keys: ['выплат', 'статус', 'заявк', 'төлем қашан', 'өтінім'],
    reply: {
      ru: 'Заявка на выплату на проверке у эксперта, срок — до 5 рабочих дней. Деньги придут на карту, указанную в заявлении.',
      kk: 'Төлем өтінімі сарапшыда тексерілуде, мерзімі — 5 жұмыс күніне дейін.',
    },
  },
  {
    id: 'policy_extend',
    name: 'Продление полиса',
    keys: ['продлить', 'продлен', 'ұзарт'],
    reply: {
      ru: 'Могу продлить полис на год на тех же условиях. Стоимость — 42 000 ₸. Оформить?',
      kk: 'Полисті бір жылға сол шарттармен ұзарта аламын. Құны — 42 000 ₸. Рәсімдейік пе?',
    },
    action: 'confirm',
  },
  {
    id: 'policy_cancel',
    name: 'Расторжение полиса',
    keys: ['расторг', 'отказаться от полис', 'вернуть деньги', 'бұзу'],
    reply: {
      ru: 'Расторжение необратимо: полис перестанет действовать, остаток вернём за 10 дней. Подтверждаете?',
      kk: 'Шартты бұзу қайтымсыз: полис әрекетін тоқтатады. Растайсыз ба?',
    },
    action: 'confirm',
  },
  {
    id: 'price_quote',
    name: 'Расчёт стоимости полиса',
    keys: ['сколько стоит', 'стоимост', 'рассчита', 'қанша тұрады', 'баға'],
    reply: {
      ru: 'Для расчёта нужна марка и год выпуска автомобиля. Какая у вас машина?',
      kk: 'Есептеу үшін көліктің маркасы мен шығарылған жылы керек.',
    },
  },
  {
    id: 'operator',
    name: 'Перевод на оператора',
    keys: ['оператор', 'живой человек', 'менеджер', 'маманға'],
    reply: {
      ru: 'Перевожу на оператора и передаю ему суть разговора, повторять не придётся.',
      kk: 'Операторға қосамын, әңгіме мазмұнын береміз.',
    },
    action: 'handoff',
  },
];

const KK_LETTERS = /[әғқңөұүһі]/i;
const RU_MARKERS = [' я ', ' и ', ' не ', 'что', 'как ', 'надо', 'нужно', 'хочу', 'можно', 'вчера', 'заказ', 'деньги', 'подал', 'статус', 'выплат'];
const YES = ['да', 'давайте', 'подтверждаю', 'иә', 'ия', 'жарайды', 'ок'];
const NO = ['нет', 'не надо', 'отмена', 'жоқ'];

const pendingBySession = new Map<string, string[]>();

function detectLang(text: string): Lang {
  const padded = ` ${text.toLowerCase()} `;
  const kk = KK_LETTERS.test(text);
  const ru = RU_MARKERS.some((m) => padded.includes(m));
  if (kk && ru) return 'mixed';
  return kk ? 'kk' : 'ru';
}

function extractParams(text: string): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  const lower = text.toLowerCase();
  if (lower.includes('вчера') || lower.includes('кеше')) out.date = 'вчера';
  if (lower.includes('сегодня') || lower.includes('бүгін')) out.date = 'сегодня';
  const policy = text.match(/\b[A-ZА-Я]{2,3}[-\s]?\d{5,}\b/);
  if (policy) out.policy_number = policy[0];
  const sum = text.match(/(\d[\d\s]{2,})\s?(тенге|тг|₸)/i);
  if (sum) out.amount = sum[1].replace(/\s/g, '');
  return out;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function rand(min: number, max: number) {
  return Math.round(min + Math.random() * (max - min));
}

export async function mockTurn(req: TurnRequest): Promise<TurnResponse> {
  const text = req.text.trim();
  const lower = ` ${text.toLowerCase()} `;
  const lang = detectLang(text);
  const replyLang = lang === 'kk' ? 'kk' : 'ru';
  const lastScenario = [...req.history].reverse().find((h) => h.scenario_id)?.scenario_id;
  const pending = pendingBySession.get(req.session_id) ?? [];

  const scored = SCENARIOS.map((s) => {
    const hits = s.keys.filter((k) => lower.includes(k));
    const firstAt = hits.length ? Math.min(...hits.map((k) => lower.indexOf(k))) : Infinity;
    return { s, hits, firstAt };
  })
    .filter((x) => x.hits.length > 0)
    .sort((a, b) => a.firstAt - b.firstAt);

  const isShortReply = text.split(/\s+/).length <= 3;
  const saidYes = isShortReply && YES.some((w) => lower.includes(` ${w}`));
  const saidNo = isShortReply && NO.some((w) => lower.includes(` ${w}`));

  let primary: MockScenario | undefined = scored[0]?.s;
  let resumed: string | null = null;
  let action: ActionType = 'answer';
  let reasoning: string;
  let reply: string;
  let confidence: number;

  const lastNeedsConfirm = SCENARIOS.find((s) => s.id === lastScenario)?.action === 'confirm';

  if (!primary && (saidYes || saidNo) && lastNeedsConfirm) {
    primary = SCENARIOS.find((s) => s.id === lastScenario);
    confidence = 0.82;
    reasoning = `Короткий ответ «${text}» относится к предыдущему вопросу агента в сценарии ${lastScenario}.`;
    reply = saidYes ? 'Готово, оформил. Что-нибудь ещё?' : 'Хорошо, ничего не меняю. Чем ещё помочь?';
  } else if (!primary && pending.length) {
    const next = pending.shift()!;
    pendingBySession.set(req.session_id, pending);
    primary = SCENARIOS.find((s) => s.id === next);
    resumed = lastScenario ?? null;
    confidence = 0.74;
    reasoning = `Новой темы в реплике нет — возвращаюсь к отложенной теме ${next}.`;
    reply = primary ? `Теперь вернёмся к вашему второму вопросу. ${primary.reply[replyLang]}` : '';
  } else if (!primary) {
    confidence = 0.31;
    action = 'clarify';
    reasoning = 'В реплике нет признаков ни одного сценария. Уточняю, а не угадываю.';
    reply =
      replyLang === 'kk'
        ? 'Кешіріңіз, нақтылап жіберіңізші: полис, төлем немесе сақтандыру жағдайы туралы сұрап тұрсыз ба?'
        : 'Уточните, пожалуйста: вопрос про полис, оплату или страховой случай?';
  } else {
    const strong = scored[0].hits.length >= 2;
    confidence = strong ? 0.93 : 0.78;
    action = primary.action ?? 'answer';
    const rest = scored.slice(1).map((x) => x.s.id);
    if (rest.length) pendingBySession.set(req.session_id, [...rest, ...pending]);
    reasoning =
      `Совпали признаки: ${scored[0].hits.map((h) => `«${h}»`).join(', ')}.` +
      (rest.length ? ` В реплике есть вторая тема (${rest.join(', ')}) — откладываю её и вернусь после первой.` : '');
    reply = primary.reply[replyLang];
    if (rest.length) {
      reply += replyLang === 'kk' ? ' Содан кейін екінші сұрағыңызға көшеміз.' : ' Потом займёмся вашим вторым вопросом.';
    }
  }

  const alternatives: Alternative[] = scored.slice(1, 3).map((x) => ({
    id: x.s.id,
    name: x.s.name,
    confidence: 0.35,
    why_not: 'Упомянуто позже — отложено как вторая тема',
  }));
  for (const s of SCENARIOS) {
    if (alternatives.length >= 2) break;
    if (s.id === primary?.id || alternatives.some((a) => a.id === s.id)) continue;
    alternatives.push({ id: s.id, name: s.name, confidence: 0.05 + Math.random() * 0.1, why_not: 'Нет признаков в реплике' });
  }

  const fast = confidence! >= 0.9;
  const route_ms = fast ? rand(18, 60) : rand(260, 620);
  const llm_ms = rand(220, 520);
  await sleep(route_ms + llm_ms);

  const scenario = primary
    ? { id: primary.id, name: primary.name, confidence: confidence! }
    : { id: 'clarify', name: 'Уточнение запроса', confidence: confidence! };

  return {
    reply_text: reply,
    lang,
    scenario,
    reasoning: reasoning!,
    alternatives,
    route_path: fast ? 'fast' : 'llm',
    action,
    params: extractParams(text),
    topic_stack: pendingBySession.get(req.session_id) ?? [],
    resumed_from: resumed,
    emotion: /(!{2,}|сколько можно|безобраз|ужас)/i.test(text) ? 'раздражение' : 'нейтрально',
    handoff_summary: action === 'handoff' ? `Клиент просит оператора. Последняя тема: ${lastScenario ?? 'нет'}.` : null,
    timings: { route_ms, llm_ms, total_ms: route_ms + llm_ms + rand(3, 12) },
  };
}
