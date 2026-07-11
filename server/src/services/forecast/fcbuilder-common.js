'use strict';
/**
 * fcbuilder-common.js — utilities shared by the BS and inc/exp builders
 * (CR043 Phase 2.3; previously duplicated verbatim in both builder files).
 */

/** Row labels of a frame; tolerant of danfo-style index objects for safety. */
const getIndexValues = (df) => {
  if (Array.isArray(df.index)) return df.index;
  if (Array.isArray(df.index?.values)) return df.index.values;
  if (Array.isArray(df.index?.index)) return df.index.index;
  return [];
};

/**
 * Flattens a category × year frame into forecast_entries payload rows,
 * skipping zero/absent cells.
 */
const buildFcEntriesPayload = (dfCategories, scenarioId, moduleName, moduleComment) => {
  const columns = dfCategories?.columns || [];
  const rows = dfCategories?.values || [];
  const indexValues = getIndexValues(dfCategories);
  const entries = [];

  for (let i = 0; i < rows.length; i++) {
    const account = indexValues[i];
    if (!account) continue;

    const row = rows[i];
    for (let j = 0; j < columns.length; j++) {
      const amount = row[j];
      if (amount == null || amount === 0) continue;
      const year = columns[j];
      if (year == null) continue;

      entries.push({
        scenario_id: scenarioId,
        forecast_year: year,
        amount: amount,
        account: account,
        module: moduleName || "",
        comment: moduleComment || null,
      });
    }
  }
  return entries;
};

/**
 * Bulk-inserts one module's prebuilt entries. Same statement as always —
 * ON CONFLICT DO UPDATE preserves the live last-write-wins semantics when two
 * inc/exp items share an account (their entries share the same module label).
 */
const insertModuleEntries = async (db, entries) => {
  if (entries.length === 0) return [];

  const values = [];
  const params = [];
  let paramIdx = 1;

  for (const entry of entries) {
    values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
    params.push(entry.scenario_id, entry.forecast_year, entry.amount, entry.account, entry.module, entry.comment);
  }

  const sql = `
    INSERT INTO forecast_entries (scenario_id, forecast_year, amount, account, module, comment)
    VALUES ${values.join(", ")}
    ON CONFLICT (scenario_id, forecast_year, account, module, entry_type)
    DO UPDATE SET amount = EXCLUDED.amount, comment = EXCLUDED.comment
  `;

  await db.query(sql, params);
  return entries;
};

module.exports = { getIndexValues, buildFcEntriesPayload, insertModuleEntries };
