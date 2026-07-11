'use strict';
/**
 * Shared test harness for route-level tests (CR043 Phase 1.2).
 *
 * Mounts a real router in a minimal Express app whose 404 + error middleware
 * mirror src/app.js exactly (so status codes and the `{ error, status }`
 * error envelope match production), and provides a dependency-free HTTP client
 * (same pattern as fc-lines.test.js — no supertest).
 */

const express = require('express');
const http = require('http');

/**
 * @param {string} mountPath e.g. '/forecast'
 * @param {import('express').Router} router
 */
function makeApp(mountPath, router) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(mountPath, router);
  // Mirror src/app.js: 404 then error handler with { error, status }.
  app.use((req, res, next) => {
    const err = new Error('Not Found');
    err.status = 404;
    next(err);
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message, status: err.status || 500 });
  });
  return app;
}

/**
 * Fire one request against a one-shot server. Returns { status, body }.
 * `path` is appended to the app root (include the mount prefix).
 */
function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = http.request(
        { hostname: 'localhost', port, path, method: method.toUpperCase(), headers: { 'Content-Type': 'application/json' } },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            server.close();
            try {
              resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
            } catch {
              resolve({ status: res.statusCode, body: data });
            }
          });
        }
      );
      req.on('error', (err) => { server.close(); reject(err); });
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

module.exports = { makeApp, request };
