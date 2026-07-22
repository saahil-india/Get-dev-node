import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import { resolveDateRange } from '../utils/dateRange.js';

const MODULES = ['Resumes', 'Vendors', 'Recruiters', 'Technologies', 'Sales'];
const router = Router();
router.use(authenticate);

// Per the requirements doc (Section 10), ticking a module only grants *data* visibility
// scoped by own/all — the ability to create/manage user accounts is owner-only, with the
// single documented exception that a sub-admin with "Recruiters" ticked may also create
// and manage recruiter accounts. Sales/Vendors/Resumes/Technologies do not grant
// account-management rights, only data access (enforced separately via requireAccess()).
function canManage(req, targetRole) {
  const u = req.user;
  if (u.role === 'owner') return true;
  if (u.role === 'subadmin' && targetRole === 'recruiter' && (u.subadmin_modules || []).includes('Recruiters')) return true;
  return false;
}

function visibleRoles(req) {
  const u = req.user;
  if (u.role === 'owner') return ['recruiter', 'sales', 'subadmin'];
  const roles = [];
  if (u.role === 'subadmin' && (u.subadmin_modules || []).includes('Recruiters')) roles.push('recruiter');
  return roles;
}

router.get('/', async (req, res) => {
  const roles = visibleRoles(req);
  if (!roles.length) return res.status(403).json({ error: 'No user-management access' });
  const { q = '', role = '', preset = 'all', from = '', to = '' } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.max(1, parseInt(req.query.perPage, 10) || 8);
  const [dfrom, dto] = resolveDateRange(preset, from, to);

  const allowedRoles = role ? (roles.includes(role) ? [role] : []) : roles;
  if (!allowedRoles.length) return res.json({ total: 0, page, perPage, items: [] });

  const where = [`role = ANY($1)`];
  const params = [allowedRoles];
  if (q) { params.push(`%${q.toLowerCase()}%`); where.push(`(lower(name || ' ' || email) LIKE $${params.length})`); }
  if (dfrom) { params.push(dfrom); where.push(`created_at >= $${params.length}`); }
  if (dto) { params.push(dto); where.push(`created_at <= $${params.length}`); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const countRes = await pool.query(`SELECT count(*)::int AS total FROM users ${whereSql}`, params);
  const total = countRes.rows[0].total;
  params.push(perPage, (page - 1) * perPage);
  const rows = await pool.query(
    `SELECT id, name, email, role, active, subadmin_modules, subadmin_scope, created_at FROM users ${whereSql}
     ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({ total, page, perPage, items: rows.rows });
});

// Unified add-user screen: one endpoint, role picker decides shape (Section "Still to build" #1)
router.post('/', async (req, res) => {
  const { name, email, password, role, modules, scope } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password || password.length < 6) {
    return res.status(400).json({ error: 'Name, email, and a password of at least 6 characters are required' });
  }
  if (!['recruiter', 'sales', 'subadmin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (!canManage(req, role)) return res.status(403).json({ error: 'You cannot create a user with that role' });
  if (role === 'subadmin' && req.user.role !== 'owner') return res.status(403).json({ error: 'Only the owner creates sub-admins' });

  const cleanModules = role === 'subadmin' ? (modules || []).filter(m => MODULES.includes(m)) : [];
  const cleanScope = role === 'subadmin' ? (scope === 'all' ? 'all' : 'own') : 'own';

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users(name,email,password_hash,role,active,subadmin_modules,subadmin_scope)
       VALUES ($1,$2,$3,$4,true,$5,$6)
       RETURNING id, name, email, role, active, subadmin_modules, subadmin_scope, created_at`,
      [name.trim(), email.trim().toLowerCase(), hash, role, cleanModules, cleanScope]
    );
    await pool.query(`INSERT INTO activity_log(actor_id, action) VALUES ($1,$2)`, [req.user.id, `created user · ${email.trim().toLowerCase()}`]);
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A user with that email already exists' });
    throw err;
  }
});

router.patch('/:id/status', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  const target = rows[0];
  if (!target) return res.status(404).json({ error: 'Not found' });
  if (target.role === 'owner') return res.status(403).json({ error: 'The owner account cannot be disabled' });
  if (!canManage(req, target.role)) return res.status(403).json({ error: 'Not permitted' });
  const { rows: updated } = await pool.query('UPDATE users SET active = NOT active WHERE id = $1 RETURNING id, active', [req.params.id]);
  res.json({ user: updated[0] });
});

export default router;
