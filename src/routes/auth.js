import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { signToken, authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  if (!user.active) return res.status(403).json({ error: 'This account has been disabled' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
  const token = signToken(user);
  const { password_hash, ...safe } = user;
  res.json({ token, user: safe });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

export default router;
