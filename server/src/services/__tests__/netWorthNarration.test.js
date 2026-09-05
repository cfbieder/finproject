'use strict';
/**
 * netWorthNarration.test.js — CR092 P1.
 *
 * The gateway is stubbed via `global.fetch`, the same way `aiReviewCompare`
 * stubs it: ocr-llm is a separate service on the tailnet, so a suite that
 * reached it would be testing their uptime rather than our caller.
 *
 * What is worth asserting here is everything on OUR side of that boundary — the
 * prompt (the contract with a service this repo cannot run in CI), the parser
 * (the only thing between a degraded response and rendered prose), and the
 * guards that decide not to call at all. Every failure path must return a null
 * narration rather than throw: the deterministic summary is the product, and
 * this is an enhancement over it.
 */

const {
  narrateNetWorthBridge,
  buildPrompt,
  buildContext,
  parseNarration,
  GATEWAY_TASK,
} = require('../netWorthNarration');

const OFFSETTING = {
  key: 'transfers',
  label: 'Transfers',
  amount: -23621,
  offsetting: true,
  gross: 1746678,
  contributors: [{ label: 'Brokerage to current account', amount: -23621 }],
};

const REVALUATION = {
  key: 'revaluation',
  label: 'Re-valued',
  amount: -1741398,
  contributors: [{ label: 'United Beverages', amount: -1873619 }],
};

const bridge = (drivers = [REVALUATION, OFFSETTING]) => ({
  from: { date: '2025-09-01', netWorth: 15000000 },
  to: { date: '2026-09-01', netWorth: 13387996 },
  change: -1612004,
  drivers,
  periods: [],
  movers: [],
  summary: ['Net worth fell $1,612,004.'],
});

const goodBody = {
  headline: 'Net worth decreased by 1,612,004.00 USD',
  why: [{ driver: 'Re-valued', note: 'A revaluation loss of 1,741,398.00 USD.' }],
  watch_outs: ['Transfers cancelled out.'],
};

const gatewayOk = (body = goodBody, extra = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    provider: 'ollama_heavy',
    model: 'qwen3.6:35b-a3b-q4_K_M',
    disclaimer: 'Informational only — not financial advice.',
    routing: { degradations: [], schema_level: 'CONSTRAINED_DECODE', fallback_depth: 0 },
    usage: { provider_latency_ms: 7810 },
    response: JSON.stringify(body),
    ...extra,
  }),
});

describe('buildPrompt — every figure inlined, because the prompt is what it narrates from', () => {
  it('states an offsetting driver as offsetting, in words as well as in the flag', () => {
    const prompt = buildPrompt(bridge());

    // The line that is most easily misread on the page: -23,621 net on
    // 1,746,678 gross is neither a loss of 23,621 nor a movement of 1.7M.
    expect(prompt).toContain('OFFSETTING');
    expect(prompt).toContain('1,746,678.00 USD of gross movement that cancelled out');
    expect(prompt).toContain('Transfers: -23,621.00 USD');
  });

  it('names each driver’s largest items', () => {
    expect(buildPrompt(bridge())).toContain('United Beverages -1,873,619.00 USD');
  });

  it('withholds periods and movers — what is narrated is what sits beside the prose', () => {
    const data = bridge();
    data.periods = [{ key: '2026-01-31', label: 'Jan 2026', change: -999999 }];
    data.movers = [{ account: 'Some Account Nobody Mentioned', change: -888888 }];

    const prompt = buildPrompt(data);
    expect(prompt).not.toContain('999,999');
    expect(prompt).not.toContain('Some Account Nobody Mentioned');
  });

  it('states the direction the change actually went', () => {
    expect(buildPrompt(bridge())).toContain('Net worth FELL by 1,612,004.00 USD');
  });

  it('leads with the drivers that moved WITH the change, not the largest', () => {
    // The defect this exists for: drivers arrive ordered by ABSOLUTE size, so
    // on a YTD window the first one is a GAIN inside a net FALL — the prose
    // opened on the fall and then led with the gain. The same mistake
    // `buildSummary` already paid for, on the LLM side of the same surface.
    const income = { key: 'income', label: 'Money earned', amount: 368590.9, contributors: [] };
    const spending = { key: 'spending', label: 'Money spent', amount: -355793.75, contributors: [] };

    const order = buildPrompt({ ...bridge([income, spending, OFFSETTING]), change: -96705.06 })
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2, l.indexOf(':')));

    // Spending moved with the fall; income moved against it; transfers
    // cancelled and caused neither, so it goes last.
    expect(order).toEqual(['Money spent', 'Money earned', 'Transfers']);
  });

  it('hands the model no direction vocabulary to echo back as a note', () => {
    // 🔴 An earlier prompt tagged each line "(with the change)". The model
    // returned the TAGS as the notes, and the modal rendered six lines reading
    // "Money spent — with the change". Vocabulary handed to a narrator is
    // vocabulary it will narrate.
    const prompt = buildPrompt(bridge());

    expect(prompt).not.toContain('(with the change)');
    expect(prompt).not.toContain('(against the change)');
  });

  it('carries no percentages of its own — a contributor may legitimately exceed its driver', () => {
    // United Beverages is -1,873,619 inside a -1,741,398 revaluation, because
    // other marks were positive. Any share we computed and sent would read as
    // an arithmetic bug on a page whose claim is that the arithmetic is exact.
    expect(buildPrompt(bridge())).not.toMatch(/%/);
  });
});

describe('buildContext — the structural twin of the prompt', () => {
  it('sends the four required keys the task validates', () => {
    const ctx = buildContext(bridge());
    expect(Object.keys(ctx).sort()).toEqual(['change', 'drivers', 'from', 'to']);
    expect(ctx.from).toBe('2025-09-01');
    expect(ctx.to).toBe('2026-09-01');
  });

  it('carries offsetting/gross on the driver that has them, and only there', () => {
    const [revaluation, transfers] = buildContext(bridge()).drivers;
    expect(transfers).toMatchObject({ offsetting: true, gross: 1746678 });
    expect(revaluation).not.toHaveProperty('offsetting');
    expect(revaluation).not.toHaveProperty('gross');
  });
});

describe('parseNarration — a half-formed object is worse than no prose', () => {
  it('accepts the documented shape, from a JSON string', () => {
    expect(parseNarration(JSON.stringify(goodBody))).toEqual({
      headline: 'Net worth decreased by 1,612,004.00 USD',
      why: [{ driver: 'Re-valued', note: 'A revaluation loss of 1,741,398.00 USD.' }],
      watchOuts: ['Transfers cancelled out.'],
    });
  });

  it.each([
    ['not JSON at all', 'the model just wrote a paragraph'],
    ['no headline', JSON.stringify({ why: [{ driver: 'x', note: '1 USD' }] })],
    ['an empty headline', JSON.stringify({ headline: '   ', why: [{ note: '1 USD' }] })],
    ['no usable why', JSON.stringify({ headline: 'h', why: [] })],
    ['why entries with no figure in them', JSON.stringify({ headline: 'h', why: [{ note: 'it fell' }] })],
    ['why entries with no note', JSON.stringify({ headline: 'h', why: [{ driver: 'd' }] })],
    ['null', null],
  ])('rejects %s', (_label, raw) => {
    expect(parseNarration(raw)).toBeNull();
  });

  it('drops a why note that carries no figure at all', () => {
    // The failure mode this locks out: notes that report the prompt's own
    // vocabulary instead of the data. Every real note here speaks a number.
    const parsed = parseNarration(JSON.stringify({
      headline: 'h',
      why: [
        { driver: 'Money spent', note: 'with the change' },
        { driver: 'Money earned', note: 'Money earned added 368,590.90 USD.' },
      ],
    }));

    expect(parsed.why).toEqual([
      { driver: 'Money earned', note: 'Money earned added 368,590.90 USD.' },
    ]);
  });

  it('returns null when NO note carries a figure', () => {
    expect(parseNarration(JSON.stringify({
      headline: 'h',
      why: [{ driver: 'Money spent', note: 'with the change' }],
    }))).toBeNull();
  });

  it('drops a watch-out that merely repeats a why note', () => {
    // Asserts OUR parser on a synthetic duplicate, and deliberately no longer
    // implies the gateway still emits them: ocr-llm fixed this at the task
    // prefix on 2026-09-05 (their rule 6) and it is re-verified against the raw
    // gateway. The check stays as defence in depth — their fix is a prompt rule
    // and so probabilistic, this is structural — so the fixture has to be
    // constructed rather than borrowed from a live response.
    //
    // The original, for the record: every `watch_outs` entry came back a
    // verbatim copy of a `why` note, and the page printed the same sentences
    // twice — once as prose, again as a bullet list headed like a caution.
    // Found by RENDERING, not by a test.
    const parsed = parseNarration(JSON.stringify({
      headline: 'h',
      why: [
        { driver: 'Transfers', note: '1,746,678.00 USD cancelled out.' },
        { driver: 'Spending', note: 'Spending reduced net worth by 482,691.00 USD.' },
      ],
      watch_outs: ['1,746,678.00 USD cancelled out.', 'Watch the exchange rate.'],
    }));

    expect(parsed.watchOuts).toEqual(['Watch the exchange rate.']);
  });

  it('matches a repeat regardless of case, and keeps genuinely new cautions', () => {
    const parsed = parseNarration(JSON.stringify({
      headline: 'h',
      why: [{ driver: 'd', note: 'One mark drove the 1,741,398.00 USD fall.' }],
      watch_outs: [
        'ONE MARK DROVE THE 1,741,398.00 USD FALL.',
        'A single posting carries the year.',
      ],
    }));

    expect(parsed.watchOuts).toEqual(['A single posting carries the year.']);
  });

  it('tolerates a missing watch_outs — it is the optional third of the shape', () => {
    const parsed = parseNarration(JSON.stringify({ headline: 'h', why: [{ note: '1 USD' }] }));
    expect(parsed.watchOuts).toEqual([]);
  });
});

describe('narrateNetWorthBridge', () => {
  let realFetch;

  beforeEach(() => {
    realFetch = global.fetch;
    process.env.OCR_LLM_CLIENT_KEY = 'test-key';
    process.env.LLM_GATEWAY_URL = 'http://gateway.test:8080';
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('calls the registered task with both identity headers', async () => {
    global.fetch = jest.fn(async () => gatewayOk());

    const { narration, meta } = await narrateNetWorthBridge(bridge(), { meta: { tieOk: true } });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('http://gateway.test:8080/task');
    // The pair or nothing: an id without a matching key is discarded, and the
    // gateway has enforced identity since 2026-08-31.
    expect(init.headers['X-Client-Id']).toBe('finance');
    expect(init.headers['X-Client-Key']).toBe('test-key');
    expect(JSON.parse(init.body).task).toBe(GATEWAY_TASK);

    expect(narration.headline).toBe('Net worth decreased by 1,612,004.00 USD');
    expect(narration.disclaimer).toBe('Informational only — not financial advice.');
    expect(meta).toMatchObject({ available: true, provider: 'ollama_heavy', fallbackDepth: 0 });
  });

  it('never calls the gateway when the drivers do not reconcile', async () => {
    global.fetch = jest.fn();

    // The page already carries a warning that these figures are out. Prose
    // explaining them as if they were sound would contradict it.
    const { narration, meta } = await narrateNetWorthBridge(bridge(), { meta: { tieOk: false } });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(narration).toBeNull();
    expect(meta.reason).toBe('tie-failed');
  });

  it('never calls the gateway with an empty drivers array', async () => {
    global.fetch = jest.fn();

    // Measured against the live task 2026-09-05: an empty array is rejected as
    // `missing_required_context` — the check is truthiness, not presence — so
    // this would spend a round trip to earn a 422.
    const { narration, meta } = await narrateNetWorthBridge(bridge([]), { meta: { tieOk: true } });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(narration).toBeNull();
    expect(meta.reason).toBe('no-drivers');
  });

  it('does not call the gateway when the client key is unset', async () => {
    global.fetch = jest.fn();
    delete process.env.OCR_LLM_CLIENT_KEY;

    const { narration, meta } = await narrateNetWorthBridge(bridge(), { meta: { tieOk: true } });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(meta.reason).toBe('not-configured');
    expect(narration).toBeNull();
  });

  it('drops the prose when the gateway reports schema_violation', async () => {
    // Nothing in the chain produced conforming output — ocr-llm's own
    // instruction is that this is the degradation to alert on. The body may
    // still parse, and it is still dropped.
    global.fetch = jest.fn(async () =>
      gatewayOk(goodBody, {
        routing: { degradations: ['schema_violation'], schema_level: 'JSON_MODE', fallback_depth: 1 },
      })
    );

    const { narration, meta } = await narrateNetWorthBridge(bridge(), { meta: { tieOk: true } });

    expect(narration).toBeNull();
    expect(meta.reason).toBe('schema-violation');
  });

  it('degrades to no narration on a gateway error, and does not throw', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => 'upstream unavailable',
    }));

    const { narration, meta } = await narrateNetWorthBridge(bridge(), { meta: { tieOk: true } });

    expect(narration).toBeNull();
    expect(meta).toEqual({ available: false, reason: 'gateway-503' });
  });

  it('degrades to no narration when the gateway is unreachable', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('fetch failed');
    });

    const { narration, meta } = await narrateNetWorthBridge(bridge(), { meta: { tieOk: true } });

    expect(narration).toBeNull();
    expect(meta.reason).toBe('gateway-unreachable');
  });

  it('reports a timeout as its own reason, not as a generic failure', async () => {
    global.fetch = jest.fn(async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    });

    const { meta } = await narrateNetWorthBridge(bridge(), { meta: { tieOk: true } });

    expect(meta.reason).toBe('timeout');
  });
});
