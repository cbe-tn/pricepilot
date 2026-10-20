-- Acheteur role + supplier price list imports (purchasing page). Additive only: safe to run on a live database.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'purchasing';

CREATE TABLE IF NOT EXISTS supplier_price_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  price_basis text NOT NULL DEFAULT 'ht',
  row_count integer NOT NULL DEFAULT 0,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_imports_workspace_idx ON supplier_price_imports (workspace_id);

ALTER TABLE supplier_quotes ADD COLUMN IF NOT EXISTS import_id uuid REFERENCES supplier_price_imports(id) ON DELETE CASCADE;
