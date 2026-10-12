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
  contact         TEXT,
  account_id      VARCHAR(34) NOT NULL UNIQUE,
  stellar_address VARCHAR(56) NOT NULL UNIQUE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Generic product: coffee today, cocoa or honey tomorrow, without code changes.
CREATE TABLE IF NOT EXISTS products (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  unit           VARCHAR(8) NOT NULL,
  quality_schema JSONB NOT NULL DEFAULT '[]'
);

-- Daily reference price. The latest row whose valid_from is not in the future applies.
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
  kind            TEXT NOT NULL DEFAULT 'IFNB',
  account_id      VARCHAR(34) NOT NULL UNIQUE,
  stellar_address VARCHAR(56) NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The loan contract lives here (private). On-chain: the disbursement, the
-- repayments and the SHA-256 of these terms in the disbursement memo.
CREATE TABLE IF NOT EXISTS credits (
  id                SERIAL PRIMARY KEY,
  reference         VARCHAR(20) NOT NULL UNIQUE,
  producer_id       INT NOT NULL REFERENCES producers(id),
  lender_id         INT NOT NULL REFERENCES lenders(id),
  purpose           TEXT NOT NULL,
  principal         NUMERIC(14,2) NOT NULL CHECK (principal > 0),
  annual_rate       NUMERIC(5,2) NOT NULL CHECK (annual_rate >= 0),
  term_months       INT NOT NULL CHECK (term_months > 0),
  interest          NUMERIC(14,2) NOT NULL,
  total_due         NUMERIC(14,2) NOT NULL,
  outstanding       NUMERIC(14,2) NOT NULL,
  repayment_percent NUMERIC(5,2) NOT NULL CHECK (repayment_percent > 0 AND repayment_percent <= 100),
  auto_deduct       BOOLEAN NOT NULL DEFAULT TRUE,
  due_date          DATE NOT NULL,
  -- pendiente → vigente → pagado; cancelado only before disbursement. "vencido" is derived.
  status            VARCHAR(12) NOT NULL DEFAULT 'pendiente',
  terms_json        TEXT NOT NULL,
  terms_sha256      CHAR(64) NOT NULL,
  disbursement_tx   CHAR(64),
  disbursed_at      TIMESTAMPTZ,
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
  notes       TEXT,
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
  -- MXN per 1 unit of the settlement token (USDC) used for the whole run.
  fx_rate        NUMERIC(14,6),
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
  -- What actually moved on Stellar: the MXN net converted at the run's rate.
  token_amount     NUMERIC(20,5),
  camt054          TEXT
);

CREATE TABLE IF NOT EXISTS credit_movements (
  id            SERIAL PRIMARY KEY,
  credit_id     INT NOT NULL REFERENCES credits(id),
  kind          VARCHAR(12) NOT NULL,            -- desembolso | abono
  amount        NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL,
  token_amount  NUMERIC(20,5),
  fx_rate       NUMERIC(14,6),
  settlement_id INT REFERENCES settlements(id),
  tx_hash       CHAR(64),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  action     TEXT NOT NULL,
  details    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export async function openDb(dataDir?: string): Promise<Db> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await db.exec(SCHEMA);
  return db;
}

export async function audit(db: Db, action: string, details: Record<string, unknown> = {}): Promise<void> {
  await db.query(`INSERT INTO audit_log (action, details) VALUES ($1, $2)`, [action, JSON.stringify(details)]);
}
