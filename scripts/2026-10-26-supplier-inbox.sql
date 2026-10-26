-- Supplier price lists received by e-mail (comparateur fournisseurs). Additive only: safe on a live database.
CREATE TABLE IF NOT EXISTS supplier_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  attachment_name text NOT NULL,
  from_address text NOT NULL,
  from_name text,
  subject text,
  received_at timestamptz,
  mime text NOT NULL,
  data_base64 text,
  status text NOT NULL DEFAULT 'pending',
  reason text,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  import_id uuid REFERENCES supplier_price_imports(id) ON DELETE SET NULL,
  price_basis text,
  row_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_inbox_workspace_idx ON supplier_inbox (workspace_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_inbox_message_idx ON supplier_inbox (workspace_id, message_id, attachment_name);
