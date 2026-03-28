/**
 * FC Lines API Tests
 *
 * Tests the FC Lines routes by mocking the repository layer.
 * Verifies request validation, response shapes, and error handling.
 */

const express = require('express');
const http = require('http');

// Mock the repository before requiring the router
const mockRepo = {
  findAll: jest.fn(),
  findById: jest.fn(),
  findByName: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  assignCategories: jest.fn(),
  unassignCategory: jest.fn(),
  findUnassignedCategories: jest.fn(),
  getBudgetTotals: jest.fn(),
  generateSuggestions: jest.fn(),
};

jest.mock('../../repositories/fcLines', () => mockRepo);

const router = require('../fcLines');

// Minimal Express app for testing
function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/fc-lines', router);
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

// Simple HTTP request helper (avoids supertest dependency)
function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const options = {
        hostname: 'localhost',
        port,
        path: `/fc-lines${path}`,
        method: method.toUpperCase(),
        headers: { 'Content-Type': 'application/json' },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });

      req.on('error', (err) => { server.close(); reject(err); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

describe('FC Lines API', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
  });

  // T1.1: Create line
  test('POST / creates a new FC Line', async () => {
    mockRepo.findByName.mockResolvedValue(null);
    mockRepo.create.mockResolvedValue({ id: 1, name: 'Test Line', line_type: 'unassigned', display_order: 0 });

    const res = await request(app, 'POST', '/', { name: 'Test Line', line_type: 'unassigned' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Test Line');
    expect(mockRepo.create).toHaveBeenCalledWith({
      name: 'Test Line',
      line_type: 'unassigned',
      display_order: 0,
    });
  });

  // T1.2: Duplicate name rejected
  test('POST / rejects duplicate name', async () => {
    mockRepo.findByName.mockResolvedValue({ id: 1, name: 'Existing' });

    const res = await request(app, 'POST', '/', { name: 'Existing' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
  });

  // T1.3: List lines with categories
  test('GET / returns lines with categories', async () => {
    mockRepo.findAll.mockResolvedValue([
      {
        id: 1, name: 'Prop Costs', line_type: 'bs_module_expense', category_count: 3,
        categories: [
          { category_id: 10, category_name: 'Condo Fees' },
          { category_id: 11, category_name: 'Insurance' },
          { category_id: 12, category_name: 'Utilities' },
        ],
      },
    ]);

    const res = await request(app, 'GET', '/', null);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].categories).toHaveLength(3);
  });

  // T1.4: Assign category
  test('POST /:id/categories assigns categories to a line', async () => {
    mockRepo.findById.mockResolvedValue({ id: 1, name: 'Test Line' });
    mockRepo.assignCategories.mockResolvedValue([
      { category_id: 10, success: true },
      { category_id: 11, success: true },
    ]);

    const res = await request(app, 'POST', '/1/categories', { category_ids: [10, 11] });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].success).toBe(true);
  });

  // T1.5: Assign requires category_ids array
  test('POST /:id/categories rejects empty array', async () => {
    const res = await request(app, 'POST', '/1/categories', { category_ids: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/category_ids/);
  });

  // T1.6: Unassign category
  test('DELETE /:id/categories/:catId unassigns a category', async () => {
    mockRepo.unassignCategory.mockResolvedValue(true);

    const res = await request(app, 'DELETE', '/1/categories/10', null);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // T1.7: Delete line cascades (no FC expense references)
  test('DELETE /:id deletes line when no FC expense references', async () => {
    mockRepo.remove.mockResolvedValue({ deleted: true, references: [] });

    const res = await request(app, 'DELETE', '/1', null);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // T1.8: Delete line blocked by forecast_income_expense references
  test('DELETE /:id blocked when referenced by forecast items', async () => {
    mockRepo.remove.mockResolvedValue({
      deleted: false,
      references: [
        { id: 5, name: 'Living Expenses', scenario_name: '2026_Base' },
      ],
    });

    const res = await request(app, 'DELETE', '/1', null);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/referenced/);
    expect(res.body.references).toHaveLength(1);
  });

  // T1.9: Delete non-existent line returns 404
  test('DELETE /:id returns 404 for non-existent line', async () => {
    mockRepo.remove.mockResolvedValue({ deleted: false, references: [] });

    const res = await request(app, 'DELETE', '/999', null);

    expect(res.status).toBe(404);
  });

  // T1.10: Generate suggestions
  test('POST /generate-suggestions creates lines from P&L hierarchy', async () => {
    mockRepo.generateSuggestions.mockResolvedValue([
      { id: 1, name: 'Property Costs', line_type: 'unassigned' },
      { id: 2, name: 'Living Expenses', line_type: 'unassigned' },
    ]);

    const res = await request(app, 'POST', '/generate-suggestions', {});

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.created_count).toBe(2);
  });

  // T1.11: Unassigned categories
  test('GET /unassigned-categories returns categories not in any line', async () => {
    mockRepo.findUnassignedCategories.mockResolvedValue([
      { id: 99, name: 'Orphan Category', parent_name: null },
    ]);

    const res = await request(app, 'GET', '/unassigned-categories', null);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.count).toBe(1);
  });

  // T1.12: Budget totals
  test('GET /budget-totals returns sums per line for a budget year', async () => {
    mockRepo.getBudgetTotals.mockResolvedValue([
      { fc_line_id: 1, fc_line_name: 'Prop Costs - PM4', line_type: 'bs_module_expense', budget_total: -2411 },
    ]);

    const res = await request(app, 'GET', '/budget-totals?budgetYear=2026', null);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].budget_total).toBe(-2411);
    expect(res.body.budgetYear).toBe(2026);
  });

  // T1.13: Update line type
  test('PUT /:id updates line type', async () => {
    mockRepo.findByName.mockResolvedValue(null);
    mockRepo.update.mockResolvedValue({ id: 1, name: 'Test', line_type: 'bs_module_expense' });

    const res = await request(app, 'PUT', '/1', { line_type: 'bs_module_expense' });

    expect(res.status).toBe(200);
    expect(res.body.data.line_type).toBe('bs_module_expense');
  });

  // Additional: POST / rejects missing name
  test('POST / rejects missing name', async () => {
    const res = await request(app, 'POST', '/', {});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Name is required/);
  });

  // Additional: GET /budget-totals rejects missing budgetYear
  test('GET /budget-totals rejects missing budgetYear', async () => {
    const res = await request(app, 'GET', '/budget-totals', null);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/budgetYear/);
  });
});
