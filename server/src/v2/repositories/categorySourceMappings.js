/**
 * Category Source Mappings Repository
 *
 * Maps external system category names (PocketSmith, Quicken) to internal app categories.
 * Allows renaming categories in the app without breaking sync.
 */

const db = require('../db');

/**
 * Find all mappings for a category
 */
async function findByCategoryId(categoryId) {
  const sql = `
    SELECT id, category_id, source, external_name, created_at
    FROM category_source_mappings
    WHERE category_id = $1
    ORDER BY source, external_name
  `;
  const result = await db.query(sql, [categoryId]);
  return result.rows;
}

/**
 * Upsert a mapping (insert or update on conflict)
 */
async function upsert(categoryId, source, externalName) {
  const sql = `
    INSERT INTO category_source_mappings (category_id, source, external_name)
    VALUES ($1, $2, $3)
    ON CONFLICT (source, external_name)
    DO UPDATE SET category_id = EXCLUDED.category_id
    RETURNING *
  `;
  const result = await db.query(sql, [categoryId, source, externalName]);
  return result.rows[0];
}

/**
 * Remove a mapping by id
 */
async function remove(id) {
  const sql = `DELETE FROM category_source_mappings WHERE id = $1 RETURNING *`;
  const result = await db.query(sql, [id]);
  return result.rows[0];
}

/**
 * Remove a specific source mapping for a category
 */
async function removeByCategoryAndSource(categoryId, source) {
  const sql = `
    DELETE FROM category_source_mappings
    WHERE category_id = $1 AND source = $2
    RETURNING *
  `;
  const result = await db.query(sql, [categoryId, source]);
  return result.rows;
}

module.exports = {
  findByCategoryId,
  upsert,
  remove,
  removeByCategoryAndSource,
};
