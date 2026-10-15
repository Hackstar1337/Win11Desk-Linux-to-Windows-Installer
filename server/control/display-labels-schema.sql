CREATE TABLE IF NOT EXISTS wc_run_labels (
  run_id CHAR(36) NOT NULL PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL DEFAULT 'default',
  display_label VARCHAR(160) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT wc_run_labels_run_fk FOREIGN KEY (run_id) REFERENCES wc_run_meta(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;
