-- Add opening balance calibration fields to accounts
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS opening_balance DECIMAL(15,2) DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS opening_balance_date DATE DEFAULT '2000-01-01';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_calibrated_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ps_transaction_account_id BIGINT;
