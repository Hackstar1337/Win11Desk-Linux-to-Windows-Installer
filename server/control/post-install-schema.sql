-- Additive, workspace-scoped post-install reports. Purge integration may remove
-- this row before deleting a wc_run_meta row, so this table intentionally has no FK.
CREATE TABLE IF NOT EXISTS wc_post_install_runs (
  run_id CHAR(36) NOT NULL PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  report_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY wc_post_install_workspace_updated (workspace_id, updated_at),
  KEY wc_post_install_updated (updated_at)
) ENGINE=InnoDB;
