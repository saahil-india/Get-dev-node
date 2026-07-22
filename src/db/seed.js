import bcrypt from 'bcryptjs';
import { pool } from './pool.js';

const TECH = [
  ['AWS','Cloud & DevOps'],['Azure','Cloud & DevOps'],['GCP','Cloud & DevOps'],['Kubernetes','Cloud & DevOps'],
  ['Docker','Cloud & DevOps'],['Terraform','Cloud & DevOps'],['Jenkins','Cloud & DevOps'],['Ansible','Cloud & DevOps'],
  ['Java','Backend'],['Spring Boot','Backend'],['Node.js','Backend'],['Python','Backend'],['Django','Backend'],
  ['.NET','Backend'],['C#','Backend'],['Go','Backend'],
  ['React','Frontend'],['Angular','Frontend'],['Vue','Frontend'],['TypeScript','Frontend'],['Next.js','Frontend'],
  ['Android','Mobile'],['iOS','Mobile'],['Flutter','Mobile'],['React Native','Mobile'],
  ['PostgreSQL','Data & ML'],['MongoDB','Data & ML'],['Spark','Data & ML'],['Airflow','Data & ML'],
  ['TensorFlow','Data & ML'],['PyTorch','Data & ML'],
  ['QA Automation','QA & Other'],['Selenium','QA & Other'],['Salesforce','QA & Other'],['SAP','QA & Other'],
];

const hash = (pw) => bcrypt.hashSync(pw, 10);

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // wipe (idempotent re-seed for a dev/demo environment)
    await client.query('TRUNCATE activity_log, vendor_technologies, candidates, vendors, sales_clients, technologies, users RESTART IDENTITY CASCADE');

    const owner = await client.query(
      `INSERT INTO users(name,email,password_hash,role,active) VALUES ($1,$2,$3,'owner',true) RETURNING id`,
      ['Admin', 'admin@getdeveloper.in', hash('admin123')]
    );
    const ravi = await client.query(
      `INSERT INTO users(name,email,password_hash,role,active) VALUES ($1,$2,$3,'recruiter',true) RETURNING id`,
      ['Ravi Kumar', 'ravi@getdeveloper.in', hash('ravi12345')]
    );
    const priya = await client.query(
      `INSERT INTO users(name,email,password_hash,role,active) VALUES ($1,$2,$3,'recruiter',true) RETURNING id`,
      ['Priya Sharma', 'priya@getdeveloper.in', hash('priya12345')]
    );
    await client.query(
      `INSERT INTO users(name,email,password_hash,role,active) VALUES ($1,$2,$3,'recruiter',false)`,
      ['Amit Verma', 'amit@getdeveloper.in', hash('amit12345')]
    );
    const sonia = await client.query(
      `INSERT INTO users(name,email,password_hash,role,active) VALUES ($1,$2,$3,'sales',true) RETURNING id`,
      ['Sonia Kapoor', 'sonia@getdeveloper.in', hash('sonia12345')]
    );
    const arjun = await client.query(
      `INSERT INTO users(name,email,password_hash,role,active) VALUES ($1,$2,$3,'sales',true) RETURNING id`,
      ['Arjun Mehta', 'arjun@getdeveloper.in', hash('arjun12345')]
    );
    await client.query(
      `INSERT INTO users(name,email,password_hash,role,active,subadmin_modules,subadmin_scope)
       VALUES ($1,$2,$3,'subadmin',true,$4,'all')`,
      ['Neha Joshi', 'neha@getdeveloper.in', hash('neha12345'), ['Vendors','Resumes','Technologies']]
    );

    const techIds = {};
    for (const [name, category] of TECH) {
      const r = await client.query(
        `INSERT INTO technologies(name,category) VALUES ($1,$2) RETURNING id`,
        [name, category]
      );
      techIds[name] = r.rows[0].id;
    }

    const stems = ['Acme','Globex','Nexus','Vertex','Quantum','Apex','Zenith','Pioneer','Catalyst','Summit',
      'Orbit','Fusion','Lumen','Cobalt','Ironclad'];
    const sufs = ['Technologies','Solutions','Systems','Labs','Consulting','Software','Digital','Group'];
    const techsets = [
      ['AWS','Kubernetes','Docker','Terraform'],['Java','Spring Boot','PostgreSQL'],
      ['React','TypeScript','Next.js'],['Python','Django','Airflow','Spark'],
      ['Android','iOS','Flutter'],['Salesforce','SAP'],['QA Automation','Selenium'],['Azure','GCP','.NET','C#'],
    ];
    const types = ['contract','fte','both'];
    const fn = ['John','Sarah','Bill','Nina','Raj','Emily','Carlos','Meera','Tom','Anya'];
    const ln = ['Doe','Lee','Ross','Park','Patel','Chen','Reyes','Nair','Becker','Kim'];
    const owners = [ravi.rows[0].id, priya.rows[0].id];

    const vendorIds = [];
    for (let i = 0; i < stems.length; i++) {
      const daysAgo = [0,1,3,6,9,13,20,28,2,5,8,11,15,18,22][i % 15];
      const created = new Date(); created.setDate(created.getDate() - daysAgo);
      const v = await client.query(
        `INSERT INTO vendors(company_name,website,linkedin,staffing_type,poc_name,poc_email,poc_phone,notes,pinned,owner_id,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'',$8,$9,$10) RETURNING id`,
        [
          `${stems[i]} ${sufs[i % sufs.length]}`,
          `${stems[i].toLowerCase()}.com`,
          `linkedin.com/company/${stems[i].toLowerCase()}`,
          types[i % 3],
          `${fn[i % 10]} ${ln[i % 10]}`,
          `${fn[i % 10].toLowerCase()}@${stems[i].toLowerCase()}.com`,
          `+1 (555) 0${100 + i}`,
          i < 3,
          owners[i % 2],
          created,
        ]
      );
      vendorIds.push(v.rows[0].id);
      for (const t of techsets[i % techsets.length]) {
        await client.query(
          `INSERT INTO vendor_technologies(vendor_id, technology_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [v.rows[0].id, techIds[t]]
        );
      }
    }

    const cats = ['DevOps','Java','Frontend','Data / ML','QA','Cloud'];
    const lvls = ['Junior','Mid','Senior','Lead'];
    const sts = ['Sourced','Submitted','Interview','Offer','Placed'];
    for (let i = 0; i < 20; i++) {
      const daysAgo = [0,2,4,6,9,12,16,20,1,3][i % 10];
      const created = new Date(); created.setDate(created.getDate() - daysAgo);
      await client.query(
        `INSERT INTO candidates(full_name,email,category,seniority,years_experience,skills,status,staffing_type,owner_id,vendor_id,resume_filename,resume_hash,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          `${fn[i % 10]} ${ln[(i + 3) % 10]}`,
          `cand${i}@example.com`,
          cats[i % 6],
          lvls[i % 4],
          2 + (i % 10),
          techsets[i % techsets.length].join(', '),
          sts[i % 5],
          i % 2 ? 'contract' : 'fte',
          owners[i % 2],
          vendorIds[i % vendorIds.length],
          `seed-resume-${i}.pdf`,
          `seed-hash-${i}`,
          created,
        ]
      );
    }

    const clientStems = ['Brightway','Cornerstone','Datapoint','Evergreen','Fairview','Greenfield','Harborline',
      'Ironbridge','Junction','Kestrel','Lakeside','Maplewood'];
    const sources = ['Referral','LinkedIn','Website','Cold call','Event','Inbound email'];
    const stages = ['Lead','Contacted','Meeting','Proposal','Negotiation','Won','Lost'];
    const salesOwners = [sonia.rows[0].id, arjun.rows[0].id];
    for (let i = 0; i < clientStems.length; i++) {
      const daysAgo = [0,2,4,6,8,10,12,14,16,18,20,22][i % 12];
      const created = new Date(); created.setDate(created.getDate() - daysAgo);
      await client.query(
        `INSERT INTO sales_clients(company,contact,email,phone,stage,source,notes,follow_up_date,owner_id,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'',$7,$8,$9)`,
        [
          `${clientStems[i]}${i % 3 === 0 ? ' Inc' : i % 3 === 1 ? ' LLC' : ' Corp'}`,
          `${fn[(i + 2) % 10]} ${ln[(i + 5) % 10]}`,
          `${fn[(i + 2) % 10].toLowerCase()}@${clientStems[i].toLowerCase()}.com`,
          `+1 (555) 1${100 + i}`,
          stages[i % stages.length],
          sources[i % sources.length],
          i % 4 === 0 ? new Date(Date.now() + 5 * 86400000) : null,
          salesOwners[i % 2],
          created,
        ]
      );
    }

    await client.query(
      `INSERT INTO activity_log(actor_id, action) VALUES ($1,'seeded the database')`,
      [owner.rows[0].id]
    );

    await client.query('COMMIT');
    console.log('Seed complete.');
    console.log('Login accounts:');
    console.log('  Owner:      admin@getdeveloper.in / admin123');
    console.log('  Recruiter:  ravi@getdeveloper.in / ravi12345');
    console.log('  Recruiter:  priya@getdeveloper.in / priya12345');
    console.log('  Sales:      sonia@getdeveloper.in / sonia12345');
    console.log('  Sales:      arjun@getdeveloper.in / arjun12345');
    console.log('  Sub-admin:  neha@getdeveloper.in / neha12345 (Vendors, Resumes, Technologies / all-data scope)');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => { console.error(err); process.exit(1); });
