/**
 * CR091 — the mint timeout is a RELATIONSHIP, not a value.
 *
 * On 2026-09-04 the Re-authorise button failed on its first live use. Nothing
 * hung: the mint returns 201 in ~54ms. fintable rate-limited it and asked for
 * 58s; bank-feed obeyed; fin aborted at the inherited DEFAULT_TIMEOUT_MS of
 * 8000 and reported a TIMEOUT, which read as "bank-feed is broken".
 *
 * A client ceiling below the server's retry budget cannot fail intermittently —
 * the request can only ever be abandoned. These tests fail the moment that
 * relationship inverts again, whichever side moves.
 */
process.env.BANK_FEED_API_KEY = process.env.BANK_FEED_API_KEY || 'test-key';
const client = require('../bankFeedClient');

describe('CR091 — mint timeout vs bank-feed retry budget', () => {
  test('the mint does not inherit the short default', () => {
    // The bug in one line: it was the only upstream call passing no timeoutMs.
    expect(client.MINT_TIMEOUT_MS).toBeGreaterThan(8000);
  });

  test('it clears bank-feed worst-case backoff, with margin', () => {
    const worstCaseBackoffMs =
      (client.BANK_FEED_MINT_MAX_ATTEMPTS - 1) * client.BANK_FEED_MINT_MAX_RETRY_AFTER_MS;
    expect(client.MINT_TIMEOUT_MS).toBeGreaterThan(worstCaseBackoffMs);
  });

  test('it clears the 58s Retry-After actually observed in production', () => {
    // The measured incident, pinned so a future "tidy up" cannot re-break it.
    expect(client.MINT_TIMEOUT_MS).toBeGreaterThan(58_000);
  });

  test('the budget inputs are stated, not folklore', () => {
    expect(Number.isFinite(client.BANK_FEED_MINT_MAX_ATTEMPTS)).toBe(true);
    expect(Number.isFinite(client.BANK_FEED_MINT_MAX_RETRY_AFTER_MS)).toBe(true);
    expect(client.BANK_FEED_MINT_MAX_ATTEMPTS).toBeGreaterThan(1);
  });
});

/**
 * The tests above read an exported constant, which a regression that simply
 * DELETED `timeoutMs: MINT_TIMEOUT_MS` from the call would still satisfy — the
 * constant would sit there, correct and unused, while the mint went back to
 * inheriting 8000ms. This one exercises the call: a fetch that never settles
 * must still be in flight well past the old ceiling.
 */
describe('CR091 — the mint actually USES the longer ceiling', () => {
  let realFetch;
  beforeEach(() => { realFetch = global.fetch; jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); global.fetch = realFetch; });

  test('is still waiting long after the old 8s default would have aborted', async () => {
    global.fetch = (_url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
      });
    });

    const pending = client.mintConnectionLink({ connectionId: 'conn_test' });
    let settled = false;
    pending.then(() => { settled = true; }, () => { settled = true; });

    // Past the OLD ceiling, and past the 58s fintable actually asked for.
    await jest.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);

    // The ceiling is still a ceiling: it does abort eventually.
    await jest.advanceTimersByTimeAsync(client.MINT_TIMEOUT_MS);
    await expect(pending).rejects.toThrow(/timed out/i);
  });
});
