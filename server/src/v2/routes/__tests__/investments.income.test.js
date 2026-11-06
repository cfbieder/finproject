/**
 * CR103 — GET /investments/income validates `year` and `reinvestRate` before any work.
 */
const express = require('express');
const http = require('http');

jest.mock('../../../services/income', () => ({ buildIncome: jest.fn().mockResolvedValue({ ok: true }) }));
const income = require('../../../services/income');
const router = require('../investments');

function get(path) {
  const app = express();
  app.use('/investments', router);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      http.get({ hostname: 'localhost', port: server.address().port, path: `/investments${path}` }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: JSON.parse(data) }); });
      }).on('error', (e) => { server.close(); reject(e); });
    });
  });
}

describe('GET /investments/income parameters', () => {
  const now = new Date().getUTCFullYear();
  beforeEach(() => income.buildIncome.mockClear());

  test.each([
    ['?year=1999'], [`?year=${now + 3}`], ['?year=abc'], ['?year='], [`?year=${now}&year=${now + 1}`],
    ['?reinvestRate=21'], ['?reinvestRate=-1'], ['?reinvestRate=3,5'], ['?reinvestRate=.5'],
  ])('%s → 400, nothing computed', async (q) => {
    const r = await get(`/income${q}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toBeTruthy();
    expect(income.buildIncome).not.toHaveBeenCalled();
  });

  test('valid year and rate pass through as numbers; an empty rate is ignored', async () => {
    expect((await get(`/income?year=${now + 1}&reinvestRate=3.29`)).status).toBe(200);
    expect(income.buildIncome).toHaveBeenLastCalledWith({ year: now + 1, reinvestRate: 3.29 });
    await get('/income?reinvestRate=');
    expect(income.buildIncome).toHaveBeenLastCalledWith({});
  });
});
