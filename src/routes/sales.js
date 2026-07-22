import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, requireAccess, dataScope } from '../middleware/auth.js';

const STAGES = ['Lead', 'Contacted', 'Meeting', 'Proposal', 'Negotiation', 'Won', 'Lost'];

const router = Router();
router.use(authenticate, requireAccess('Sales'));

router.get('/clients', async (req, res) => {
  const scope = dataScope(req, 'Sales');
  const params = [];
  let where = '';
  if (!scope.all) { params.push(scope.ownerId); where = `WHERE sc.owner_id = $1`; }
  const { rows } = await pool.query(
    `SELECT sc.*, u.name AS owner_name FROM sales_clients sc JOIN users u ON u.id = sc.owner_id ${where} ORDER BY sc.created_at DESC`,
    params
  );
  res.json({ items: rows });
});

router.post('/clients', async (req, res) => {
  const { company, contact, email, phone, stage, source, notes, follow_up_date } = req.body || {};
  if (!company || !company.trim()) return res.status(400).json({ error: 'Company required' });
  if (req.user.role !== 'sales' && !(req.user.role === 'owner' || req.user.role === 'subadmin')) {
    return res.status(403).json({ error: 'Only sales users add clients' });
  }
  const { rows } = await pool.query(
    `INSERT INTO sales_clients(company, contact, email, phone, stage, source, notes, follow_up_date, owner_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [company.trim(), contact || '', email || '', phone || '', STAGES.includes(stage) ? stage : 'Lead', source || '', notes || '', follow_up_date || null, req.user.id]
  );
  res.status(201).json({ client: rows[0] });
});

router.patch('/clients/:id', async (req, res) => {
  const scope = dataScope(req, 'Sales');
  const { rows } = await pool.query('SELECT * FROM sales_clients WHERE id = $1', [req.params.id]);
  const cl = rows[0];
  if (!cl) return res.status(404).json({ error: 'Not found' });
  if (!scope.all && cl.owner_id !== scope.ownerId) return res.status(403).json({ error: 'Not your client' });
  if (req.body.stage && !STAGES.includes(req.body.stage)) return res.status(400).json({ error: 'Invalid stage' });
  const fields = ['company', 'contact', 'email', 'phone', 'stage', 'source', 'notes', 'follow_up_date'];
  const sets = []; const params = [];
  for (const f of fields) if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f} = $${params.length}`); }
  if (sets.length) { params.push(req.params.id); await pool.query(`UPDATE sales_clients SET ${sets.join(', ')} WHERE id = $${params.length}`, params); }
  const updated = await pool.query('SELECT * FROM sales_clients WHERE id = $1', [req.params.id]);
  res.json({ client: updated.rows[0] });
});

router.delete('/clients/:id', async (req, res) => {
  const scope = dataScope(req, 'Sales');
  const { rows } = await pool.query('SELECT * FROM sales_clients WHERE id = $1', [req.params.id]);
  const cl = rows[0];
  if (!cl) return res.status(404).json({ error: 'Not found' });
  if (!scope.all && cl.owner_id !== scope.ownerId) return res.status(403).json({ error: 'Not your client' });
  await pool.query('DELETE FROM sales_clients WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

async function statsFor(ownerId) {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const { rows } = await pool.query('SELECT stage, created_at FROM sales_clients WHERE owner_id = $1', [ownerId]);
  const leads = rows.length;
  const won = rows.filter(r => r.stage === 'Won').length;
  const open = rows.filter(r => !['Won', 'Lost'].includes(r.stage)).length;
  const conv = leads ? Math.round((won / leads) * 100) : 0;
  const thisMonthLeads = rows.filter(r => new Date(r.created_at) >= thisMonthStart).length;
  const lastMonthLeads = rows.filter(r => new Date(r.created_at) >= lastMonthStart && new Date(r.created_at) < thisMonthStart).length;
  const byStage = {};
  for (const s of STAGES) byStage[s] = rows.filter(r => r.stage === s).length;
  return { leads, won, conv, open, thisMonthLeads, lastMonthLeads, byStage };
}

router.get('/dashboard/me', async (req, res) => {
  if (req.user.role !== 'sales') return res.status(403).json({ error: 'Salesperson dashboard only' });
  res.json(await statsFor(req.user.id));
});

router.get('/leaderboard', async (req, res) => {
  const scope = dataScope(req, 'Sales');
  if (!scope.all) return res.status(403).json({ error: 'Owner (or all-data sub-admin) only' });
  const { rows: sp } = await pool.query(`SELECT id, name, email FROM users WHERE role = 'sales' ORDER BY name`);
  const rows = [];
  for (const s of sp) rows.push({ name: s.name, email: s.email, ...(await statsFor(s.id)) });
  rows.sort((a, b) => b.conv - a.conv);
  res.json({ items: rows });
});

export default router;
