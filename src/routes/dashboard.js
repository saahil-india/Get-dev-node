import { Router } from 'express';
import { pool } from '../db/pool.js';
import { authenticate, dataScope } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  if (req.user.role === 'sales') return res.status(400).json({ error: 'Sales users use /api/sales/dashboard/me' });

  const scopeR = dataScope(req, 'Resumes');
  const scopeV = dataScope(req, 'Vendors');

  const candParams = []; let candWhere = '';
  if (!scopeR.all) { candParams.push(scopeR.ownerId); candWhere = 'WHERE owner_id = $1'; }
  const cands = await pool.query(`SELECT category FROM candidates ${candWhere}`, candParams);

  const vendParams = []; let vendWhere = '';
  if (!scopeV.all) { vendParams.push(scopeV.ownerId); vendWhere = 'WHERE owner_id = $1'; }
  const vendorCount = await pool.query(`SELECT count(*)::int AS n FROM vendors ${vendWhere}`, vendParams);

  const byCategory = {};
  for (const r of cands.rows) byCategory[r.category] = (byCategory[r.category] || 0) + 1;

  const payload = {
    totalResumes: cands.rows.length,
    vendorCount: vendorCount.rows[0].n,
    resumesByCategory: byCategory,
  };

  // Full company-wide view (recruiter performance table, sales leaderboard, activity feed)
  // is only shown when the caller has all-data scope across both Resumes and Vendors —
  // i.e. the owner, or a sub-admin with both modules ticked and scope = all.
  if (scopeR.all && scopeV.all) {
    const recruiters = await pool.query(`SELECT id, name, email FROM users WHERE role = 'recruiter' ORDER BY name`);
    const perRecruiter = [];
    for (const r of recruiters.rows) {
      const v = await pool.query('SELECT count(*)::int AS n FROM vendors WHERE owner_id = $1', [r.id]);
      const c = await pool.query('SELECT count(*)::int AS n FROM candidates WHERE owner_id = $1', [r.id]);
      perRecruiter.push({ name: r.name, email: r.email, vendors: v.rows[0].n, candidates: c.rows[0].n });
    }
    const activity = await pool.query(
      `SELECT a.action, a.created_at, u.name AS actor_name FROM activity_log a LEFT JOIN users u ON u.id = a.actor_id
       ORDER BY a.created_at DESC LIMIT 15`
    );
    payload.recruiterPerformance = perRecruiter;
    payload.recentActivity = activity.rows;
  }

  res.json(payload);
});

export default router;
