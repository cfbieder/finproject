/**
 * Accounts Repository
 *
 * Database operations for the accounts table.
 * Includes recursive CTE queries for hierarchical account structure.
 *
 * As of migration 021, the legacy `categories` table has been collapsed into
 * accounts. P&L leaves carry `is_transfer` and `ps_category_id` directly.
 */

const db = require('../db');

/**
 * CR063 — the depth-first position of every account in the COA tree, as a
 * comparable array: `[parent rank, parent id, …, own rank, own id]`.
 *
 * Migration 049 made `display_order` a rank WITHIN THE PARENT, which is the only
 * form a reorder UI can maintain. That leaves FLAT lists (`findAll`,
 * `getBalances`, `findPLeaves`, `/accounts/categories`) with nothing global to
 * sort on — a bare `ORDER BY display_order` would interleave every parent's
 * rank-1 child, then every rank-2, which is not an order anybody asked for.
 * Joining this CTE gives them the same order the tree renders in.
 *
 * Inactive rows are included: a flat list that asks for them (activeOnly=false)
 * still needs a position, and excluding them here would drop those rows on the
 * join instead of merely sorting them oddly.
 */
const SORT_PATH_CTE = `
  WITH RECURSIVE account_sort AS (
    SELECT id, ARRAY[display_order, id] AS sort_path
      FROM accounts
     WHERE parent_id IS NULL
    UNION ALL
    SELECT a.id, s.sort_path || ARRAY[a.display_order, a.id]
      FROM accounts a
      JOIN account_sort s ON a.parent_id = s.id
  )
`;

/**
 * Get all accounts
 */
async function findAll({ section, accountType, activeOnly = true, leafOnly = false } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (activeOnly) {
    conditions.push('a.is_active = TRUE');
  }
  if (section) {
    conditions.push(`a.section = $${paramIndex++}`);
    params.push(section);
  }
  if (accountType) {
    conditions.push(`a.account_type = $${paramIndex++}`);
    params.push(accountType);
  }
  if (leafOnly) {
    conditions.push('NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id)');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    ${SORT_PATH_CTE}
    SELECT
      a.*,
      p.name as parent_name
    FROM accounts a
    LEFT JOIN accounts p ON a.parent_id = p.id
    JOIN account_sort s ON s.id = a.id
    ${whereClause}
    ORDER BY s.sort_path
  `;

  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Get account by ID
 */
async function findById(id) {
  const sql = `
    SELECT a.*, p.name as parent_name
    FROM accounts a
    LEFT JOIN accounts p ON a.parent_id = p.id
    WHERE a.id = $1
  `;
  const result = await db.query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Get account by name
 */
async function findByName(name) {
  const sql = `SELECT * FROM accounts WHERE name = $1`;
  const result = await db.query(sql, [name]);
  return result.rows[0] || null;
}

/**
 * Get account by PocketSmith category ID
 */
async function findByPsCategoryId(psCategoryId) {
  const sql = `SELECT * FROM accounts WHERE ps_category_id = $1`;
  const result = await db.query(sql, [psCategoryId]);
  return result.rows[0] || null;
}

/**
 * Get account hierarchy as tree (using recursive CTE)
 */
async function getTree({ section, rootOnly = false } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (section) {
    conditions.push(`section = $${paramIndex++}`);
    params.push(section);
  }
  if (rootOnly) {
    conditions.push('parent_id IS NULL');
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  // CR063: sibling order comes from `display_order` (a rank within the parent,
  // established by migration 049), NOT from the id path. Until then this sorted
  // `ORDER BY path` where path is ARRAY[id] — i.e. INSERTION order — which is
  // what every tree, report and dropdown in the app inherited, because they all
  // funnel through here. `id` stays in the sort key as the tiebreak so a
  // duplicate rank degrades to the old behaviour rather than to a random order.
  // Same form as the tree in routes/ingestPs.js.
  const sql = `
    WITH RECURSIVE account_tree AS (
      -- Base case: root accounts (no parent)
      SELECT
        id, name, parent_id, account_type, section, currency,
        display_order, 0 as depth, ARRAY[id] as path,
        ARRAY[display_order, id] as sort_path, name::text as full_path
      FROM accounts
      WHERE parent_id IS NULL AND is_active = TRUE

      UNION ALL

      -- Recursive case: children
      SELECT
        a.id, a.name, a.parent_id, a.account_type, a.section, a.currency,
        a.display_order, t.depth + 1, t.path || a.id,
        t.sort_path || ARRAY[a.display_order, a.id], t.full_path || ' > ' || a.name
      FROM accounts a
      JOIN account_tree t ON a.parent_id = t.id
      WHERE a.is_active = TRUE
    )
    SELECT * FROM account_tree
    ${whereClause}
    ORDER BY sort_path
  `;

  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Get children of an account
 */
async function getChildren(parentId) {
  const sql = `
    SELECT * FROM accounts
    WHERE parent_id = $1 AND is_active = TRUE
    ORDER BY display_order, name
  `;
  const result = await db.query(sql, [parentId]);
  return result.rows;
}

/**
 * Get all descendants of an account (recursive)
 */
async function getDescendants(accountId) {
  const sql = `
    WITH RECURSIVE descendants AS (
      SELECT id, name, parent_id, 0 as depth
      FROM accounts WHERE id = $1

      UNION ALL

      SELECT a.id, a.name, a.parent_id, d.depth + 1
      FROM accounts a
      JOIN descendants d ON a.parent_id = d.id
      WHERE a.is_active = TRUE
    )
    SELECT * FROM descendants WHERE id != $1
    ORDER BY depth, name
  `;

  const result = await db.query(sql, [accountId]);
  return result.rows;
}

/**
 * Get account balances from transactions.
 * After migration 021, transactions.category_id references accounts(id) directly.
 */
async function getBalances({ asOfDate, section } = {}) {
  const conditions = ['a.is_active = TRUE'];
  const params = [];
  let paramIndex = 1;

  if (asOfDate) {
    conditions.push(`t.transaction_date <= $${paramIndex++}`);
    params.push(asOfDate);
  }
  if (section) {
    conditions.push(`a.section = $${paramIndex++}`);
    params.push(section);
  }

  const sql = `
    ${SORT_PATH_CTE}
    SELECT
      a.id, a.name, a.account_type, a.section, a.currency, a.parent_id,
      COALESCE(SUM(t.base_amount), 0) as balance
    FROM accounts a
    JOIN account_sort s ON s.id = a.id
    LEFT JOIN transactions t ON t.category_id = a.id
      ${asOfDate ? `AND t.transaction_date <= $1` : ''}
    WHERE ${conditions.join(' AND ')}
    GROUP BY a.id, a.name, a.account_type, a.section, a.currency, a.parent_id, s.sort_path
    ORDER BY s.sort_path
  `;

  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Find P&L leaves (replaces categories.findAll for the dropdown / filter use-case).
 * Returns leaf accounts in the profit_loss section, ordered by name.
 */
async function findPLeaves({ activeOnly = true, includeTransfers = false } = {}) {
  const conditions = ['a.section = \'profit_loss\''];
  if (activeOnly) conditions.push('a.is_active = TRUE');
  if (!includeTransfers) conditions.push('a.is_transfer = FALSE');
  conditions.push('NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id AND c.is_active = TRUE)');

  // CR063 P3: was ORDER BY a.name. A P&L leaf list is a dropdown — it should read
  // in the order the owner arranged the COA, not alphabetically, which scatters
  // the leaves of one category across the list.
  const sql = `
    ${SORT_PATH_CTE}
    SELECT
      a.id, a.name, a.parent_id, a.is_transfer, a.is_active,
      a.ps_category_id, a.account_type,
      p.name as parent_name
    FROM accounts a
    LEFT JOIN accounts p ON a.parent_id = p.id
    JOIN account_sort s ON s.id = a.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY s.sort_path
  `;

  const result = await db.query(sql);
  return result.rows;
}

/**
 * Compute is_transfer for an account based on its position in the COA tree.
 * Returns TRUE if any ancestor is named "Transfers".
 */
async function computeIsTransfer(accountId) {
  const sql = `
    WITH RECURSIVE ancestors AS (
      SELECT id, name, parent_id FROM accounts WHERE id = $1
      UNION ALL
      SELECT a.id, a.name, a.parent_id
      FROM accounts a JOIN ancestors an ON a.id = an.parent_id
    )
    SELECT EXISTS (SELECT 1 FROM ancestors WHERE name = 'Transfers' AND id != $1) AS is_transfer
  `;
  const result = await db.query(sql, [accountId]);
  return result.rows[0]?.is_transfer === true;
}

/**
 * Create a new account
 */
async function create(data) {
  // CR063: a new account APPENDS to the end of its parent's group. This read
  // `data.display_order || 0` until 2026-07-31, which put every account created
  // since the seed at rank 0 — 22 of them on dev, all tied. Once display_order
  // is authoritative (migration 049), a 0 would file each new account at the TOP
  // of its group, which is what made "the category I just added is buried
  // somewhere odd" the standing complaint and drove the alphabetical sort in
  // useCoa. An explicit display_order in `data` still wins (the reorder path).
  const sql = `
    INSERT INTO accounts (
      name, parent_id, account_type, section, currency,
      account_number, display_order, is_active, ps_account_name,
      opening_balance, opening_balance_date, ps_transaction_account_id,
      is_transfer, ps_category_id
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      COALESCE($7, (
        SELECT COALESCE(MAX(display_order), 0) + 1
          FROM accounts
         WHERE parent_id IS NOT DISTINCT FROM $2::INTEGER
      )),
      $8, $9, $10, $11, $12, $13, $14
    )
    RETURNING *
  `;

  const result = await db.query(sql, [
    data.name,
    data.parent_id || null,
    data.account_type,
    data.section,
    data.currency || 'USD',
    data.account_number || null,
    // NULL (not 0) means "append" — see the COALESCE in the INSERT above. `?? null`
    // rather than `|| null` so an explicit 0 is still an explicit 0.
    data.display_order ?? null,
    data.is_active !== false,
    data.ps_account_name || data.name,
    data.opening_balance || 0,
    // 1990-01-01, matching the column DEFAULT migration 022 set and the 68
    // accounts it migrated. This read '2000-01-01' until 2026-07-30, which
    // meant every account created after that migration RE-INTRODUCED the
    // sentinel the migration existed to remove — nine on prod by then. The
    // sentinel is a floor on every balance read, so an account carrying it
    // silently hides any transaction dated before 2000.
    data.opening_balance_date || '1990-01-01',
    data.ps_transaction_account_id || null,
    data.is_transfer === true,
    data.ps_category_id || null
  ]);

  return result.rows[0];
}

/**
 * Update an account
 */
async function update(id, data) {
  const fields = [];
  const params = [];
  let paramIndex = 1;

  const allowedFields = [
    'name', 'parent_id', 'account_type', 'section', 'currency',
    'account_number', 'display_order', 'is_active', 'ps_account_name',
    'opening_balance', 'opening_balance_date', 'last_calibrated_at',
    'ps_transaction_account_id', 'is_transfer', 'ps_category_id'
  ];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      fields.push(`${field} = $${paramIndex++}`);
      params.push(data[field]);
    }
  }

  if (fields.length === 0) return null;

  params.push(id);

  const sql = `
    UPDATE accounts SET ${fields.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

/**
 * CR063 — rewrite the sibling order under one parent.
 *
 * Takes the WHOLE ordered list of that parent's active children, not a single
 * "move this one up" step. The whole-list form is idempotent, writes in one
 * transaction, and cannot interleave with a concurrent reorder into a
 * half-applied state — and it lets the caller be REJECTED when its view of the
 * children is stale, which a per-row nudge cannot detect at all.
 *
 * Returns { ok: true } on success, or { ok: false, reason, … } when the supplied
 * ids are not exactly this parent's active children — deliberately not an
 * exception, so the route can turn it into a 400 with something useful in it.
 *
 * `parentId` may be null for the root level.
 */
async function reorderChildren(parentId, orderedIds) {
  const ids = Array.isArray(orderedIds) ? orderedIds.map(Number) : [];
  if (!ids.length || ids.some((id) => !Number.isInteger(id))) {
    return { ok: false, reason: 'orderedIds must be a non-empty array of account ids' };
  }
  if (new Set(ids).size !== ids.length) {
    return { ok: false, reason: 'orderedIds contains duplicates' };
  }

  const actual = await db.query(
    `SELECT id FROM accounts
      WHERE parent_id IS NOT DISTINCT FROM $1 AND is_active = TRUE
      ORDER BY display_order, id`,
    [parentId ?? null]
  );
  const actualIds = actual.rows.map((r) => r.id);

  // The set must match exactly. A client holding a stale tree — one that has not
  // seen an account added, deleted or moved elsewhere since it loaded — would
  // otherwise write an order that silently drops or resurrects a row.
  const supplied = new Set(ids);
  const missing = actualIds.filter((id) => !supplied.has(id));
  const unknown = ids.filter((id) => !actualIds.includes(id));
  if (missing.length || unknown.length) {
    return {
      ok: false,
      reason: 'orderedIds must be exactly this parent\'s active children',
      missing,
      unknown,
      expectedCount: actualIds.length,
    };
  }

  await db.transaction(async (client) => {
    // Two passes through a negative staging range. A direct 1..n write collides
    // with the rows it has not rewritten yet the moment any unique constraint or
    // index is added on (parent_id, display_order) — the transient-violation trap
    // CR050's sweep-priority sync hit for real.
    for (let i = 0; i < ids.length; i += 1) {
      await client.query('UPDATE accounts SET display_order = $1 WHERE id = $2', [
        -(i + 1),
        ids[i],
      ]);
    }
    for (let i = 0; i < ids.length; i += 1) {
      await client.query('UPDATE accounts SET display_order = $1 WHERE id = $2', [
        i + 1,
        ids[i],
      ]);
    }
  });

  return { ok: true, count: ids.length };
}

/**
 * Soft delete an account (set is_active = false)
 */
async function remove(id) {
  const sql = `UPDATE accounts SET is_active = FALSE WHERE id = $1 RETURNING id`;
  const result = await db.query(sql, [id]);
  return result.rowCount > 0;
}

/**
 * Get account hierarchy as a nested { name, children } tree.
 *
 * Uses the flat rows from getTree() and assembles them into a nested
 * structure suitable for frontend rendering.
 */
async function getNestedTree({ section } = {}) {
  const rows = await getTree({ section });

  const nodeMap = new Map();
  const roots = [];

  for (const row of rows) {
    // CR063: `id` and `display_order` ride along so the COA page can reorder by
    // id instead of by the synthetic `path|name` key it builds today. Additive —
    // every consumer keys off `name`/`children` and ignores the rest.
    const node = {
      id: row.id,
      display_order: row.display_order,
      name: row.name,
      children: [],
    };
    nodeMap.set(row.id, node);

    if (row.parent_id && nodeMap.has(row.parent_id)) {
      nodeMap.get(row.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * `PL61 1090 …3000` → `PL61 …3000`. Never reversible, never logged.
 * Same rule as `routes/tax.js` — one masking convention across the app.
 */
function maskAccountNumber(n) {
  if (!n) return '';
  const s = String(n).replace(/\s+/g, '');
  if (s.length <= 8) return `…${s.slice(-2)}`;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/**
 * Get a traits map mirroring the shape of coa_traits.json.
 *
 * Returns { "AccountName": { Currency, Type, AccountNumberMasked, HasAccountNumber } }
 *
 * ── CR082 P0a: `AccountNumber` used to be here, in full, for every active
 * account ──
 *
 * This is the payload every COA page load fetches, and it was the standing
 * counter-example to CR082 §7.1's claim that numbers are "masked in the UI with
 * an explicit reveal": they were served in bulk to any caller, and the CR's own
 * "appears in no log line" gate would have passed while this endpoint handed
 * over the whole set. P0b closed the network paths (loopback binds + tailnet);
 * it did not touch the payload, and 32 of 36 FBAR designations now hold full
 * foreign account numbers.
 *
 * The full value is not gone — it comes from `GET /util/coa/:id/account-number`,
 * one account at a time, which the COA edit form calls when it opens. That is
 * not a security boundary (this app has no auth, and the CR says so plainly); it
 * is blast radius. A bulk dump is the thing that leaks.
 */
async function getTraitsMap() {
  const sql = `
    SELECT name, currency, account_type, account_number
    FROM accounts
    WHERE is_active = TRUE
    ORDER BY name
  `;
  const result = await db.query(sql);
  const traits = {};
  for (const row of result.rows) {
    traits[row.name] = {
      Currency: row.currency || 'N/A',
      Type: row.account_type,
      AccountNumberMasked: maskAccountNumber(row.account_number),
      HasAccountNumber: !!row.account_number,
    };
  }
  return traits;
}

module.exports = {
  findAll,
  findById,
  findByName,
  findByPsCategoryId,
  getTree,
  getNestedTree,
  getChildren,
  getDescendants,
  getBalances,
  getTraitsMap,
  maskAccountNumber,
  findPLeaves,
  computeIsTransfer,
  create,
  update,
  reorderChildren,
  remove
};
