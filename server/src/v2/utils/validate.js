'use strict';
/**
 * validate.js — CR037 P6: hand-rolled field-whitelist + type checks for the
 * endpoints that write money. Deliberately NOT a schema library (zod/joi
 * adoption stays a backlog item); these helpers throw Errors with
 * `.status = 400` so the central error middleware answers with a 400 instead
 * of a 500 (or a silent bad write).
 *
 * Number fields accept numeric strings (pg does, and some callers send them),
 * but reject '', booleans, NaN and Infinity.
 */

const AppError = require('./AppError');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Kept as a thin wrapper so existing `throw badRequest(...)` call sites are
// unchanged; now returns an AppError (still `.status = 400`).
function badRequest(message) {
  return AppError.badRequest(message);
}

/** Body must be a plain object (not an array/null/scalar). */
function assertPlainObject(value, context) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw badRequest(`${context}: body must be a JSON object`);
  }
}

/** Reject unknown keys so typos fail loud instead of being silently dropped. */
function assertAllowedFields(data, allowed, context) {
  const unknown = Object.keys(data).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    throw badRequest(`${context}: unknown field(s): ${unknown.join(', ')}`);
  }
}

function isFiniteNumberLike(value) {
  if (typeof value === 'boolean') return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return Number.isFinite(Number(value));
}

function assertFiniteNumber(value, name, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return;
    throw badRequest(`${name} is required and must be a finite number`);
  }
  if (!isFiniteNumberLike(value)) {
    throw badRequest(`${name} must be a finite number`);
  }
}

function assertInteger(value, name, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return;
    throw badRequest(`${name} is required and must be an integer`);
  }
  if (!isFiniteNumberLike(value) || !Number.isInteger(Number(value))) {
    throw badRequest(`${name} must be an integer`);
  }
}

function assertDateString(value, name, { optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return;
    throw badRequest(`${name} is required (YYYY-MM-DD)`);
  }
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw badRequest(`${name} must be a YYYY-MM-DD date string`);
  }
}

function assertBoolean(value, name, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return;
    throw badRequest(`${name} is required and must be a boolean`);
  }
  if (typeof value !== 'boolean') {
    throw badRequest(`${name} must be a boolean`);
  }
}

module.exports = {
  badRequest,
  assertPlainObject,
  assertAllowedFields,
  assertFiniteNumber,
  assertInteger,
  assertDateString,
  assertBoolean,
};
