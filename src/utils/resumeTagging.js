import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

// Keyword dictionaries for the "free, instant" auto-tagging path (Section 5 of the
// requirements doc). An LLM-based path can be dropped in later behind the same
// tagResumeText() signature without touching callers.
const CATEGORY_KEYWORDS = {
  DevOps: ['devops', 'kubernetes', 'docker', 'terraform', 'ci/cd', 'jenkins', 'ansible', 'aws', 'azure', 'gcp'],
  Java: ['java', 'spring boot', 'spring', 'hibernate', 'j2ee'],
  Frontend: ['react', 'angular', 'vue', 'typescript', 'next.js', 'javascript', 'css', 'html'],
  'Data / ML': ['spark', 'airflow', 'tensorflow', 'pytorch', 'machine learning', 'data engineer', 'etl'],
  QA: ['selenium', 'qa automation', 'sdet', 'cypress', 'test automation', 'quality assurance'],
  Cloud: ['aws', 'azure', 'gcp', 'cloud architect', 'cloud engineer'],
};
const SENIORITY_KEYWORDS = {
  Lead: ['lead', 'principal', 'staff engineer', 'architect'],
  Senior: ['senior', 'sr.', 'sr '],
  Mid: ['mid-level', 'mid level'],
  Junior: ['junior', 'jr.', 'entry level', 'associate'],
};

export function tagResumeText(text) {
  const lower = (text || '').toLowerCase();
  let category = 'DevOps';
  let bestScore = -1;
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = words.reduce((s, w) => s + (lower.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; category = cat; }
  }
  let seniority = 'Mid';
  for (const [level, words] of Object.entries(SENIORITY_KEYWORDS)) {
    if (words.some(w => lower.includes(w))) { seniority = level; break; }
  }
  const yearsMatch = lower.match(/(\d{1,2})\s*\+?\s*years?/);
  const years = yearsMatch ? Math.min(parseInt(yearsMatch[1], 10), 25) : (seniority === 'Lead' ? 9 : seniority === 'Senior' ? 6 : seniority === 'Junior' ? 1 : 3);
  return { category, seniority, years_experience: years };
}

export async function extractText(filePath, mimeOrExt) {
  const ext = (mimeOrExt || path.extname(filePath)).toLowerCase();
  const buf = await fs.readFile(filePath);
  if (ext.includes('pdf')) {
    const parsed = await pdfParse(buf);
    return parsed.text || '';
  }
  if (ext.includes('doc')) {
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value || '';
  }
  return buf.toString('utf8');
}

export function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
