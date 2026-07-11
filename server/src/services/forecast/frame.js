'use strict';
/**
 * frame.js — LabelFrame, a minimal label-indexed 2D table (CR043 Phase 2.3).
 *
 * Replaces danfojs-node in the forecast engine. The engine only ever used a
 * DataFrame as (a) a column-keyed read-only table of assumption series,
 * (b) a row-label-indexed mutable zeros matrix of category × year amounts, and
 * (c) a container the audit-trail CSV writer reads `.columns` / `.values` /
 * `.index` from — none of which needs a dataframe library (danfojs dragged the
 * entire TensorFlow native chain into the image for label lookups).
 *
 * Interface intentionally mirrors the danfo subset the engine consumed:
 *   frame.columns        -> array of column labels
 *   frame.index          -> plain array of row labels
 *   frame.values         -> row-major 2D array (mutable in place)
 *   frame.column(name)   -> { values } column view (copy)
 */

class LabelFrame {
  /**
   * @param {number[][]} matrix row-major values
   * @param {{columns: Array, index: Array}} opts
   */
  constructor(matrix, { columns, index } = {}) {
    if (!Array.isArray(matrix)) throw new Error('LabelFrame: matrix must be an array of rows');
    if (!Array.isArray(columns) || !Array.isArray(index)) {
      throw new Error('LabelFrame: columns and index are required arrays');
    }
    if (matrix.length !== index.length) {
      throw new Error(`LabelFrame: ${matrix.length} rows but ${index.length} index labels`);
    }
    // Duplicate row labels made danfo throw an opaque "IndexError: Row index
    // must contain unique values" mid-generate; fail with an actionable message.
    const seen = new Set();
    for (const label of index) {
      if (seen.has(label)) {
        throw new Error(`LabelFrame: duplicate row label "${label}" — category labels must be unique`);
      }
      seen.add(label);
    }
    this.columns = columns;
    this.index = index;
    this.values = matrix;
  }

  /** Column-keyed construction: { colName: valuesArray, ... } + row index. */
  static fromColumns(columnsObj, { index } = {}) {
    const columns = Object.keys(columnsObj);
    const rowCount = index?.length ?? (columns.length ? columnsObj[columns[0]].length : 0);
    for (const name of columns) {
      if (columnsObj[name].length !== rowCount) {
        throw new Error(`LabelFrame: column "${name}" has ${columnsObj[name].length} values, expected ${rowCount}`);
      }
    }
    const matrix = new Array(rowCount);
    for (let r = 0; r < rowCount; r++) {
      const row = new Array(columns.length);
      for (let c = 0; c < columns.length; c++) row[c] = columnsObj[columns[c]][r];
      matrix[r] = row;
    }
    return new LabelFrame(matrix, { columns, index: index ?? Array.from({ length: rowCount }, (_, i) => i) });
  }

  /** Label-indexed zeros matrix (the category × year accumulator). */
  static zeros(index, columns) {
    const matrix = new Array(index.length);
    for (let i = 0; i < index.length; i++) matrix[i] = new Array(columns.length).fill(0);
    return new LabelFrame(matrix, { columns, index });
  }

  /** danfo-compatible column read: frame.column(name).values */
  column(name) {
    const c = this.columns.indexOf(name);
    if (c === -1) throw new Error(`LabelFrame: no column "${name}"`);
    const values = new Array(this.values.length);
    for (let r = 0; r < this.values.length; r++) values[r] = this.values[r][c];
    return { values };
  }
}

module.exports = { LabelFrame };
