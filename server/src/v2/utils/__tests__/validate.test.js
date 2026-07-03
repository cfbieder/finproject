'use strict';
/**
 * validate.test.js — CR037 P6 field-whitelist/type helpers. Pure unit tests,
 * no DB required.
 */

const v = require('../validate');

describe('validate helpers', () => {
  test('badRequest carries status 400', () => {
    const err = v.badRequest('nope');
    expect(err.status).toBe(400);
    expect(err.message).toBe('nope');
  });

  test('assertPlainObject rejects arrays, null, and scalars', () => {
    expect(() => v.assertPlainObject({}, 'x')).not.toThrow();
    for (const bad of [[], null, 'str', 42, undefined]) {
      expect(() => v.assertPlainObject(bad, 'x')).toThrow(/JSON object/);
    }
  });

  test('assertAllowedFields rejects unknown keys, names them', () => {
    expect(() => v.assertAllowedFields({ a: 1 }, ['a', 'b'], 'x')).not.toThrow();
    expect(() => v.assertAllowedFields({ a: 1, bogus: 2 }, ['a'], 'x'))
      .toThrow(/unknown field\(s\): bogus/);
  });

  test('assertFiniteNumber: numbers and numeric strings pass; junk fails', () => {
    expect(() => v.assertFiniteNumber(1.5, 'n')).not.toThrow();
    expect(() => v.assertFiniteNumber('-2.5', 'n')).not.toThrow();
    for (const bad of ['abc', '', ' ', true, NaN, Infinity, undefined, null]) {
      expect(() => v.assertFiniteNumber(bad, 'n')).toThrow(/finite number/);
    }
    expect(() => v.assertFiniteNumber(undefined, 'n', { optional: true })).not.toThrow();
    expect(() => v.assertFiniteNumber(null, 'n', { optional: true })).not.toThrow();
  });

  test('assertInteger: ints pass; floats and junk fail', () => {
    expect(() => v.assertInteger(7, 'i')).not.toThrow();
    expect(() => v.assertInteger('7', 'i')).not.toThrow();
    for (const bad of [7.5, 'x', '', true, null, undefined]) {
      expect(() => v.assertInteger(bad, 'i')).toThrow(/integer/);
    }
    expect(() => v.assertInteger(null, 'i', { optional: true })).not.toThrow();
  });

  test('assertDateString: strict YYYY-MM-DD', () => {
    expect(() => v.assertDateString('2026-07-03', 'd')).not.toThrow();
    for (const bad of ['2026-7-3', '03/07/2026', '2026-07-03T00:00:00Z', 'garbage', 42]) {
      expect(() => v.assertDateString(bad, 'd')).toThrow(/YYYY-MM-DD/);
    }
    expect(() => v.assertDateString(undefined, 'd', { optional: true })).not.toThrow();
    expect(() => v.assertDateString(null, 'd', { optional: true })).not.toThrow();
    expect(() => v.assertDateString('', 'd', { optional: true })).not.toThrow();
  });

  test('assertBoolean: strict booleans only', () => {
    expect(() => v.assertBoolean(true, 'b')).not.toThrow();
    expect(() => v.assertBoolean(false, 'b')).not.toThrow();
    for (const bad of ['true', 1, 0, null, undefined]) {
      expect(() => v.assertBoolean(bad, 'b')).toThrow(/boolean/);
    }
    expect(() => v.assertBoolean(undefined, 'b', { optional: true })).not.toThrow();
  });
});
