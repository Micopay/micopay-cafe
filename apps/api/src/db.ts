import { PGlite } from '@electric-sql/pglite';
import { mkdirSync } from 'node:fs';

/**
 * Local development runs on PGlite (real Postgres compiled to WASM, no install).
 * The SQL is plain Postgres so the same schema runs on the shared AWS instance later.
 */
export type Db = PGlite;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cooperatives (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  account_id      VARCHAR(34) NOT NULL UNIQUE,
  stellar_address VARCHAR(56) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS producers (
  id              SERIAL PRIMARY KEY,
  cooperative_id  INT NOT NULL REFERENCES cooperatives(id),
  name            TEXT NOT NULL,
  community       TEXT,
  account_id      VARCHAR(34) NOT NULL UNIQUE,
  stellar_address VARCHAR(56) NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Generic product: coffee today, cocoa or honey tomorrow, without code changes.
CREATE TABLE IF NOT EXISTS products (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  unit           VARCHAR(8) NOT NULL,
  quality_schema JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS prices (
  id             SERIAL PRIMARY KEY,
  product_id     INT NOT NULL REFERENCES products(id),
  cooperative_id INT NOT NULL REFERENCES cooperatives(id),
  price_per_unit NUMERIC(14,2) NOT NULL,
  currency       CHAR(3) NOT NULL DEFAULT 'MXN',
  valid_from     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tiered quality deductions: the highest tier whose threshold is exceeded applies.
CREATE TABLE IF NOT EXISTS deduction_rules (
  id          SERIAL PRIMARY KEY,
  product_id  INT NOT NULL REFERENCES products(id),
  attribute   TEXT NOT NULL,
  above       NUMERIC(8,2) NOT NULL,
  percent     NUMERIC(5,2) NOT NULL,
  reason      VARCHAR(4) NOT NULL,
  label       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lenders (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  account_id      VARCHAR(34) NOT NULL UNIQUE,
  stellar_address VARCHAR(56) NOT NULL UNIQUE
);

-- The loan contract lives here (private); only money movements and hashes go on-chain.
CREATE TABLE IF NOT EXISTS credits (
  id                SERIAL PRIMARY KEY,
  reference         VARCHAR(20) NOT NULL UNIQUE,
  producer_id       INT NOT NULL REFERENCES producers(id),
  lender_id         INT NOT NULL REFERENCES lenders(id),
  purpose           TEXT NOT NULL,
  principal         NUMERIC(14,2) NOT NULL,
  outstanding       NUMERIC(14,2) NOT NULL,
  repayment_percent NUMERIC(5,2) NOT NULL,
  status            VARCHAR(12) NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deliveries (
  id          SERIAL PRIMARY KEY,
  reference   VARCHAR(20) NOT NULL UNIQUE,
  producer_id INT NOT NULL REFERENCES producers(id),
  product_id  INT NOT NULL REFERENCES products(id),
  quantity    NUMERIC(12,2) NOT NULL,
  quality     JSONB NOT NULL DEFAULT '{}',
  lot         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_runs (
  id             SERIAL PRIMARY KEY,
  cooperative_id INT NOT NULL REFERENCES cooperatives(id),
  msg_id         VARCHAR(35) NOT NULL UNIQUE,
  pmt_inf_id     VARCHAR(35) NOT NULL UNIQUE,
  status         VARCHAR(12) NOT NULL DEFAULT 'draft',
  pain001        TEXT,
  pain001_sha256 CHAR(64),
  pain002        TEXT,
  tx_hash        CHAR(64),
  result_code    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS settlements (
  id               SERIAL PRIMARY KEY,
  delivery_id      INT NOT NULL UNIQUE REFERENCES deliveries(id),
  unit_price       NUMERIC(14,2) NOT NULL,
  gross            NUMERIC(14,2) NOT NULL,
  deductions       JSONB NOT NULL DEFAULT '[]',
  credit_id        INT REFERENCES credits(id),
  credit_repayment NUMERIC(14,2) NOT NULL DEFAULT 0,
  net              NUMERIC(14,2) NOT NULL,
  currency         CHAR(3) NOT NULL DEFAULT 'MXN',
  status           VARCHAR(12) NOT NULL DEFAULT 'pending',
  run_id           INT REFERENCES payment_runs(id),
  instr_id         VARCHAR(35),
  end_to_end_id    VARCHAR(35),
  uetr             UUID,
  camt054          TEXT
);
`;

export async function openDb(dataDir?: string): Promise<Db> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await db.exec(SCHEMA);
  return db;
}
