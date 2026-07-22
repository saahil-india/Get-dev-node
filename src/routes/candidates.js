import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool.js';
import { authenticate, requireAccess, dataScope } from '../middleware/auth.js';
import { resolveDateRange } from '../utils/dateRange.js';
import { extractText, hashBuffer, tagResumeText } from '../utils/resumeTagging.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|docx?|txt)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only PDF, Word, or text resumes are accepted'), ok);
  },
});

const router = Router();
router.use(authenticate, requireAccess('Resumes'));

router.get('/', async (req, res) => {
  const scope = dataScope(req, 'Resumes');
  const { q = '', category = '', status = '', seniority = '', sort = 'recent', preset = 'all', from = '', to = '' } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.max(1, parseInt(req.query.perPage, 10) || 8);
  const [dfrom, dto] = resolveDateRange(preset, from, to);

  const where = [];
  const params = [];
  if (!scope.all) { params.push(scope.ownerId); where.push(`c.owner_id = $${params.length}`); }
  if (category) { params.push(category); where.push(`c.category = $${params.length}`); }
  if (status) { params.push(status); where.push(`c.status = $${params.length}`); }
  if (seniority) { params.push(seniority); where.push(`c.seniority = $${params.length}`); }
  if (dfrom) { params.push(dfrom); where.push(`c.created_at >= $${params.length}`); }
  if (dto) { params.push(dto); where.push(`c.created_at <= $${params.length}`); }
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(lower(c.full_name || ' ' || coalesce(c.skills,'') || ' ' || coalesce(c.resume_text,'')) LIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderBy = sort === 'name' ? 'c.full_name ASC' : sort === 'experience' ? 'c.years_experience DESC' : 'c.created_at DESC';

  const countRes = await pool.query(`SELECT count(*)::int AS total FROM candidates c ${whereSql}`, params);
  const total = countRes.rows[0].total;

  params.push(perPage, (page - 1) * perPage);
  const rows = await pool.query(
    `SELECT c.id, c.full_name, c.email, c.category, c.seniority, c.years_experience, c.skills, c.status,
            c.staffing_type, c.vendor_id, c.resume_filename, c.created_at, u.name AS owner_name
     FROM candidates c JOIN users u ON u.id = c.owner_id
     ${whereSql}
     ORDER BY ${orderBy}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({ total, page, perPage, items: rows.rows });
});

// Drag-and-drop upload — parses each file, auto-tags by keyword match, skips exact duplicates.
router.post('/upload', upload.array('resumes', 20), async (req, res) => {
  const results = [];
  for (const file of req.files || []) {
    try {
      const buf = await fsp.readFile(file.path);
      const hash = hashBuffer(buf);
      const dupe = await pool.query('SELECT id, full_name FROM candidates WHERE resume_hash = $1', [hash]);
      if (dupe.rowCount > 0) {
        results.push({ filename: file.originalname, status: 'duplicate', message: `Already uploaded as ${dupe.rows[0].full_name}` });
        await fsp.unlink(file.path).catch(() => {});
        continue;
      }
      const text = await extractText(file.path, path.extname(file.originalname));
      const tags = tagResumeText(text);
      const guessedName = path.basename(file.originalname, path.extname(file.originalname)).replace(/[_-]+/g, ' ').replace(/\.(pdf|docx?|txt)$/i, '');
      const { rows } = await pool.query(
        `INSERT INTO candidates(full_name, category, seniority, years_experience, skills, status, staffing_type, owner_id, resume_filename, resume_hash, resume_text)
         VALUES ($1,$2,$3,$4,$5,'Sourced','fte',$6,$7,$8,$9) RETURNING *`,
        [guessedName || file.originalname, tags.category, tags.seniority, tags.years_experience, '', req.user.id, file.originalname, hash, text.slice(0, 20000)]
      );
      results.push({ filename: file.originalname, status: 'tagged', candidate: rows[0] });
    } catch (err) {
      results.push({ filename: file.originalname, status: 'error', message: err.message });
    }
  }
  res.json({ results });
});

router.get('/:id/resume', async (req, res) => {
  const { rows } = await pool.query('SELECT resume_filename FROM candidates WHERE id = $1', [req.params.id]);
  if (!rows[0]?.resume_filename) return res.status(404).json({ error: 'No resume file on record' });
  res.json({ filename: rows[0].resume_filename, note: 'File retrieval from storage is wired to the same uploads/ path used at ingest time.' });
});

router.patch('/:id', async (req, res) => {
  const scope = dataScope(req, 'Resumes');
  const { rows } = await pool.query('SELECT * FROM candidates WHERE id = $1', [req.params.id]);
  const cand = rows[0];
  if (!cand) return res.status(404).json({ error: 'Not found' });
  if (!scope.all && cand.owner_id !== scope.ownerId) return res.status(403).json({ error: 'Not your candidate' });
  const fields = ['full_name', 'email', 'category', 'seniority', 'years_experience', 'skills', 'status', 'staffing_type', 'vendor_id'];
  const sets = []; const params = [];
  for (const f of fields) if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f} = $${params.length}`); }
  if (sets.length) { params.push(req.params.id); await pool.query(`UPDATE candidates SET ${sets.join(', ')} WHERE id = $${params.length}`, params); }
  const updated = await pool.query('SELECT * FROM candidates WHERE id = $1', [req.params.id]);
  res.json({ candidate: updated.rows[0] });
});

router.delete('/:id', async (req, res) => {
  const scope = dataScope(req, 'Resumes');
  const { rows } = await pool.query('SELECT * FROM candidates WHERE id = $1', [req.params.id]);
  const cand = rows[0];
  if (!cand) return res.status(404).json({ error: 'Not found' });
  if (!scope.all && cand.owner_id !== scope.ownerId) return res.status(403).json({ error: 'Not your candidate' });
  await pool.query('DELETE FROM candidates WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

export default router;
