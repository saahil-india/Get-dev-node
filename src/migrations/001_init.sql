-- GD Portal initial schema

CREATE TYPE user_role AS ENUM ('owner','recruiter','sales','subadmin');
CREATE TYPE staffing_type_enum AS ENUM ('contract','fte','both');
CREATE TYPE candidate_status_enum AS ENUM ('Sourced','Submitted','Interview','Offer','Placed','Rejected');
CREATE TYPE sales_stage_enum AS ENUM ('Lead','Contacted','Meeting','Proposal','Negotiation','Won','Lost');

CREATE TABLE users (
  id serial PRIMARY KEY,
  name varchar(200) NOT NULL,
  email varchar(200) NOT NULL UNIQUE,
  password_hash varchar(200) NOT NULL,
  role user_role NOT NULL,
  active boolean NOT NULL DEFAULT true,
  -- only meaningful when role = 'subadmin'
  subadmin_modules text[] NOT NULL DEFAULT '{}',
  subadmin_scope varchar(10) NOT NULL DEFAULT 'own' CHECK (subadmin_scope IN ('own','all')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE technologies (
  id serial PRIMARY KEY,
  name varchar(100) NOT NULL UNIQUE,
  category varchar(100) NOT NULL DEFAULT 'Other',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vendors (
  id serial PRIMARY KEY,
  company_name varchar(200) NOT NULL,
  company_name_key varchar(200) GENERATED ALWAYS AS (regexp_replace(lower(company_name), '[^a-z0-9]', '', 'g')) STORED,
  website varchar(200),
  linkedin varchar(200),
  staffing_type staffing_type_enum NOT NULL DEFAULT 'both',
  poc_name varchar(200) NOT NULL,
  poc_name_key varchar(200) GENERATED ALWAYS AS (regexp_replace(lower(poc_name), '[^a-z0-9]', '', 'g')) STORED,
  poc_email varchar(200),
  poc_phone varchar(50),
  notes text,
  pinned boolean NOT NULL DEFAULT false,
  owner_id integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- company + POC pair must be unique company-wide (same company allowed under a different POC)
CREATE UNIQUE INDEX vendors_company_poc_unique ON vendors(company_name_key, poc_name_key);

CREATE TABLE vendor_technologies (
  vendor_id integer NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  technology_id integer NOT NULL REFERENCES technologies(id) ON DELETE CASCADE,
  PRIMARY KEY (vendor_id, technology_id)
);

CREATE TABLE candidates (
  id serial PRIMARY KEY,
  full_name varchar(200) NOT NULL,
  email varchar(200),
  category varchar(100),
  seniority varchar(50),
  years_experience integer NOT NULL DEFAULT 0,
  skills text,
  status candidate_status_enum NOT NULL DEFAULT 'Sourced',
  staffing_type staffing_type_enum NOT NULL DEFAULT 'fte',
  owner_id integer NOT NULL REFERENCES users(id),
  vendor_id integer REFERENCES vendors(id),
  resume_filename varchar(255),
  resume_hash varchar(64),
  resume_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- duplicate resume (same file contents) is skipped company-wide
CREATE UNIQUE INDEX candidates_resume_hash_unique ON candidates(resume_hash) WHERE resume_hash IS NOT NULL;

CREATE TABLE sales_clients (
  id serial PRIMARY KEY,
  company varchar(200) NOT NULL,
  contact varchar(200),
  email varchar(200),
  phone varchar(50),
  stage sales_stage_enum NOT NULL DEFAULT 'Lead',
  source varchar(100),
  notes text,
  follow_up_date date,
  owner_id integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activity_log (
  id serial PRIMARY KEY,
  actor_id integer REFERENCES users(id),
  action varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vendors_owner ON vendors(owner_id);
CREATE INDEX idx_candidates_owner ON candidates(owner_id);
CREATE INDEX idx_sales_clients_owner ON sales_clients(owner_id);
