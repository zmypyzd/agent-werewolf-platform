-- Agent Lab registration replaces legacy table-level invites.
-- The old invite_tokens table carried table_id-bound links, so existing tokens
-- are intentionally invalid after this migration.
DROP TABLE IF EXISTS invite_tokens;
