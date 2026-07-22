import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, requireAccess, dataScope } from '../middleware/auth.js';
import { resolveDateRange } from '../utils/dateRange.js';

const router = Router();
router.use(authenticate, requireAccess('Vendors'));

const normKey = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// GET /api/vendors — search, filter, sort, pin-first, pagination, date range
router.get('/', async (req, res) => {
  const scope = dataScope(req, 'Vendors');
  const { q = '', type = '', sort = 'usage', preset = 'all', from = '', to = '' } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.max(1, parseInt(req.query.perPage, 10) || 8);
  const [dfrom, dto] = resolveDateRange(preset, from, to);

  const where = [];
  const params = [];
  if (!scope.all) { params.push(scope.ownerId); where.push(`v.owner_id = $${params.length}`); }
  if (type) { params.push(type); where.push(`v.staffing_type = $${params.length}`); }
  if (dfrom) { params.push(dfrom); where.push(`v.created_at >= $${params.length}`); }
  if (dto) { params.push(dto); where.push(`v.created_at <= $${params.length}`); }
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(lower(v.company_name || ' ' || v.poc_name || ' ' || coalesce(v.poc_email,'') || ' ' || coalesce(tech.tech_stack,'')) LIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const orderBy = sort === 'name' ? 'v.company_name ASC'
    : sort === 'recent' ? 'v.created_at DESC'
    : 'cand_count DESC'; // usage (default)

  const baseSql = `
    FROM vendors v
    JOIN users u ON u.id = v.owner_id
    LEFT JOIN LATERAL (
      SELECT string_agg(t.name, ', ') AS tech_stack
      FROM vendor_technologies vt JOIN technologies t ON t.id = vt.technology_id
      WHERE vt.vendor_id = v.id
    ) tech ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS cand_count FROM candidates c WHERE c.vendor_id = v.id
    ) cc ON true
    ${whereSql}
  `;

  const countRes = await pool.query(`SELECT count(*)::int AS total ${baseSql}`, params);
  const total = countRes.rows[0].total;

  params.push(perPage, (page - 1) * perPage);
  const rows = await pool.query(
    `SELECT v.*, u.name AS owner_name, coalesce(tech.tech_stack,'') AS tech_stack, coalesce(cc.cand_count,0) AS cand_count
     ${baseSql}
     ORDER BY v.pinned DESC, ${orderBy}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({ total, page, perPage, items: rows.rows });
});

router.get('/check-duplicate', async (req, res) => {
  const company = normKey(req.query.company);
  const poc = normKey(req.query.poc);
  if (!company || !poc) return res.json({ companyExists: false, pairExists: false });
  const companyExists = await pool.query('SELECT 1 FROM vendors WHERE company_name_key = $1 LIMIT 1', [company]);
  const pairExists = await pool.query('SELECT 1 FROM vendors WHERE company_name_key = $1 AND poc_name_key = $2 LIMIT 1', [company, poc]);
  res.json({ companyExists: companyExists.rowCount > 0, pairExists: pairExists.rowCount > 0 });
});

router.post('/', async (req, res) => {
  const { company_name, website, linkedin, staffing_type, poc_name, poc_email, poc_phone, notes, technology_ids } = req.body || {};
  if (!company_name || !company_name.trim()) return res.status(400).json({ error: 'Company name required' });
  if (!poc_name || !poc_name.trim()) return res.status(400).json({ error: 'POC name required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let vendor;
    try {
      const r = await client.query(
        `INSERT INTO vendors(company_name, website, linkedin, staffing_type, poc_name, poc_email, poc_phone, notes, owner_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [company_name.trim(), website || '', linkedin || '', staffing_type || 'both', poc_name.trim(), poc_email || '', poc_phone || '', notes || '', req.user.id]
      );
      vendor = r.rows[0];
    } catch (err) {
      if (err.code === '23505') { // unique_violation
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This vendor already exists, please contact admin.' });
      }
      throw err;
    }
    for (const techId of (technology_ids || [])) {
      await client.query('INSERT INTO vendor_technologies(vendor_id, technology_id) VALUES ($1,$2)', [vendor.id, techId]);
    }
    await client.query(`INSERT INTO activity_log(actor_id, action) VALUES ($1,$2)`, [req.user.id, `added vendor · ${company_name.trim()}`]);
    await client.query('COMMIT');
    res.status(201).json({ vendor });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.patch('/:id', async (req, res) => {
  const scope = dataScope(req, 'Vendors');
  const { rows } = await pool.query('SELECT * FROM vendors WHERE id = $1', [req.params.id]);
  const vendor = rows[0];
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
  if (!scope.all && vendor.owner_id !== scope.ownerId) return res.status(403).json({ error: 'Not your vendor' });

  const fields = ['company_name', 'website', 'linkedin', 'staffing_type', 'poc_name', 'poc_email', 'poc_phone', 'notes', 'pinned'];
  const sets = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f} = $${params.length}`); }
  }
  if (sets.length) {
    params.push(req.params.id);
    try {
      await pool.query(`UPDATE vendors SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'This vendor already exists, please contact admin.' });
      throw err;
    }
  }
  if (req.body.technology_ids) {
    await pool.query('DELETE FROM vendor_technologies WHERE vendor_id = $1', [req.params.id]);
    for (const techId of req.body.technology_ids) {
      await pool.query('INSERT INTO vendor_technologies(vendor_id, technology_id) VALUES ($1,$2)', [req.params.id, techId]);
    }
  }
  const updated = await pool.query('SELECT * FROM vendors WHERE id = $1', [req.params.id]);
  res.json({ vendor: updated.rows[0] });
});

router.delete('/:id', async (req, res) => {
  const scope = dataScope(req, 'Vendors');
  const { rows } = await pool.query('SELECT * FROM vendors WHERE id = $1', [req.params.id]);
  const vendor = rows[0];
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
  if (!scope.all && vendor.owner_id !== scope.ownerId) return res.status(403).json({ error: 'Not your vendor' });
  await pool.query('DELETE FROM vendors WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

export default router;
