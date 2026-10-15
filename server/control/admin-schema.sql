-- Win11Desk Control Center additive schema. This file intentionally uses raw SQL;
-- it does not alter Drizzle's legacy tracking tables.
CREATE TABLE IF NOT EXISTS wc_commands (
  id CHAR(36) NOT NULL PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL DEFAULT 'default',
  owner_id VARCHAR(128) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  batch_id CHAR(36) NULL,
  label VARCHAR(160) NOT NULL DEFAULT '',
  provider VARCHAR(160) NULL,
  tags_json JSON NOT NULL,
  username VARCHAR(64) NOT NULL,
  remote_port INT NOT NULL,
  retries INT NOT NULL,
  iso_url TEXT NOT NULL,
  iso_sha256 CHAR(64) NOT NULL,
  target_json JSON NOT NULL,
  config_json JSON NOT NULL,
  installer_version JSON NOT NULL,
  installer_digest CHAR(64) NOT NULL,
  artifact_ciphertext MEDIUMTEXT NOT NULL,
  artifact_iv CHAR(32) NOT NULL,
  artifact_tag CHAR(32) NOT NULL,
  artifact_key_id VARCHAR(64) NOT NULL,
  credential_ciphertext MEDIUMTEXT NOT NULL,
  credential_iv CHAR(32) NOT NULL,
  credential_tag CHAR(32) NOT NULL,
  credential_key_id VARCHAR(64) NOT NULL,
  credential_version INT NOT NULL DEFAULT 1,
  delivery_hash CHAR(64) NOT NULL,
  group_id CHAR(36) NOT NULL,
  read_token_ciphertext MEDIUMTEXT NOT NULL,
  read_token_iv CHAR(32) NOT NULL,
  read_token_tag CHAR(32) NOT NULL,
  write_token_ciphertext MEDIUMTEXT NOT NULL,
  write_token_iv CHAR(32) NOT NULL,
  write_token_tag CHAR(32) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  download_count INT NOT NULL DEFAULT 0,
  last_used_at DATETIME(3) NULL,
  created_by_batch TINYINT(1) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  archived_at DATETIME(3) NULL,
  UNIQUE KEY wc_commands_idempotency (workspace_id, owner_id, idempotency_key),
  UNIQUE KEY wc_commands_delivery (delivery_hash),
  KEY wc_commands_owner_created (workspace_id, owner_id, created_at),
  KEY wc_commands_group (group_id),
  KEY wc_commands_expires (expires_at, revoked_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wc_run_meta (
  run_id CHAR(36) NOT NULL PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL DEFAULT 'default',
  owner_id VARCHAR(128) NOT NULL,
  command_id CHAR(36) NOT NULL,
  group_id CHAR(36) NOT NULL,
  nonce_hash CHAR(64) NULL,
  report_hash CHAR(64) NULL,
  hostname VARCHAR(253) NULL,
  whole_disk VARCHAR(128) NULL,
  rdp_port INT NULL,
  public_ip VARCHAR(45) NULL,
  stage VARCHAR(64) NOT NULL DEFAULT 'starting',
  phase VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL,
  registered_at DATETIME(3) NOT NULL,
  started_at DATETIME(3) NULL,
  stage_at DATETIME(3) NULL,
  last_heartbeat_at DATETIME(3) NULL,
  last_event_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  downloaded_bytes BIGINT NULL,
  total_bytes BIGINT NULL,
  windows_edition VARCHAR(64) NULL,
  windows_build INT NULL,
  rdp_listening TINYINT(1) NULL,
  credential_available TINYINT(1) NOT NULL DEFAULT 1,
  notes TEXT NULL,
  tags_json JSON NOT NULL,
  archived_at DATETIME(3) NULL,
  trashed_at DATETIME(3) NULL,
  purged_at DATETIME(3) NULL,
  tombstone_code VARCHAR(64) NULL,
  UNIQUE KEY wc_run_nonce (command_id, nonce_hash),
  KEY wc_run_scope_created (workspace_id, owner_id, created_at),
  KEY wc_run_status (stage, finished_at, trashed_at),
  KEY wc_run_command (command_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wc_events (
  run_id CHAR(36) NOT NULL,
  event_id VARCHAR(128) NOT NULL,
  sequence_no INT NOT NULL DEFAULT 0,
  phase VARCHAR(64) NULL,
  stage VARCHAR(64) NOT NULL,
  safe_code VARCHAR(96) NULL,
  proof_json JSON NULL,
  payload_json JSON NOT NULL,
  client_at DATETIME(3) NULL,
  received_at DATETIME(3) NOT NULL,
  PRIMARY KEY (run_id, event_id),
  KEY wc_events_run_received (run_id, received_at),
  KEY wc_events_run_sequence (run_id, sequence_no)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wc_settings (
  workspace_id VARCHAR(64) NOT NULL PRIMARY KEY,
  revision INT NOT NULL DEFAULT 1,
  settings_json JSON NOT NULL,
  updated_by VARCHAR(128) NOT NULL,
  updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wc_presets (
  id CHAR(36) NOT NULL PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL DEFAULT 'default',
  owner_id VARCHAR(128) NOT NULL,
  label VARCHAR(160) NOT NULL,
  settings_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  archived_at DATETIME(3) NULL,
  UNIQUE KEY wc_presets_label (workspace_id, owner_id, label)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wc_notifications (
  id CHAR(36) NOT NULL PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL DEFAULT 'default',
  owner_id VARCHAR(128) NOT NULL,
  run_id CHAR(36) NULL,
  kind VARCHAR(32) NOT NULL,
  title VARCHAR(160) NOT NULL,
  body VARCHAR(500) NOT NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  KEY wc_notifications_owner (workspace_id, owner_id, created_at)
) ENGINE=InnoDB;

-- The first read creates no secret and gives the settings editor a stable revision.
INSERT IGNORE INTO wc_settings (workspace_id, revision, settings_json, updated_by, updated_at)
VALUES ('default', 1, JSON_OBJECT('username','Administrator','remotePort',22,'retries',10,'isoUrl',''), 'system', UTC_TIMESTAMP(3));
