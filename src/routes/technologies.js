import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, requireOwner } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// Read is available to anyone signed in who needs the tech picker (owner, recruiters,
// sub-admins) — only mutation is owner-only per the requirements doc (Section 6).
router.get('/', async (req, res) => {
  const { q = '' } = req.query;
  const params = [];
  let where = '';
  if (q) { params.push(`%${q.toLowerCase()}%`); where = `WHERE lower(t.name) LIKE $1 OR lower(t.category) LIKE $1`; }
  const { rows } = await pool.query(
    `SELECT t.*, coalesce(u.usage_count,0) AS usage_count
     FROM technologies t
     LEFT JOIN LATERAL (SELECT count(*)::int AS usage_count FROM vendor_technologies vt WHERE vt.technology_id = t.id) u ON true
     ${where}
     ORDER BY t.category, t.name`,
    params
  );
  res.json({ items: rows });
});

router.post('/', requireOwner, async (req, res) => {
  const { name, category } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO technologies(name, category) VALUES ($1,$2) RETURNING *',
      [name.trim(), (category || 'Other').trim()]
    );
    res.status(201).json({ technology: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That technology already exists' });
    throw err;
  }
});

router.patch('/:id', requireOwner, async (req, res) => {
  const { name, category } = req.body || {};
  try {
    const { rows } = await pool.query(
      'UPDATE technologies SET name = coalesce($1,name), category = coalesce($2,category) WHERE id = $3 RETURNING *',
      [name?.trim(), category?.trim(), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ technology: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That technology already exists' });
    throw err;
  }
});

router.delete('/:id', requireOwner, async (req, res) => {
  await pool.query('DELETE FROM technologies WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

export default router;
