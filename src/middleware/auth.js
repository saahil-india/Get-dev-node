import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function signToken(user) {
  return jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '12h' });
}

/**
 * Verifies the bearer token and loads the current, live user row (so a
 * disabled/deleted account is rejected immediately, not just at login).
 */
export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query(
      `SELECT id, name, email, role, active, subadmin_modules, subadmin_scope FROM users WHERE id = $1`,
      [payload.sub]
    );
    const user = rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Account not found or disabled' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

/**
 * Module names as used throughout the app: Resumes, Vendors, Recruiters, Technologies, Sales.
 * Every module-guarded route must call requireAccess(moduleName) — this is the single
 * enforcement point so permissions can never be bypassed by only hiding UI.
 */
export function requireAccess(moduleName) {
  return (req, res, next) => {
    const u = req.user;
    if (u.role === 'owner') return next();
    if (moduleName === 'Vendors' && u.role === 'recruiter') return next();
    if (moduleName === 'Resumes' && u.role === 'recruiter') return next();
    if (moduleName === 'Sales' && u.role === 'sales') return next();
    if (u.role === 'subadmin' && (u.subadmin_modules || []).includes(moduleName)) return next();
    return res.status(403).json({ error: 'You do not have access to this section' });
  };
}

export function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
  next();
}

/**
 * Returns { all: boolean, ownerId } describing what data scope the current user
 * is allowed to see for a given module. Used by routes to build the SQL WHERE clause.
 */
export function dataScope(req, moduleName) {
  const u = req.user;
  if (u.role === 'owner') return { all: true };
  if (u.role === 'subadmin' && (u.subadmin_modules || []).includes(moduleName)) {
    return u.subadmin_scope === 'all' ? { all: true } : { all: false, ownerId: u.id };
  }
  return { all: false, ownerId: u.id };
}
