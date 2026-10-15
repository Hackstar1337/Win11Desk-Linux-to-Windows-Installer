-- Additive, workspace-scoped remote-install control-plane records.
-- No table stores a plaintext SSH or Windows password. Envelopes are encrypted
-- by server/control/crypto.ts and are deleted at terminal pre-dispatch states.
CREATE TABLE IF NOT EXISTS wc_remote_trust (
  workspace_id VARCHAR(64) NOT NULL,
  host VARCHAR(64) NOT NULL,
  port INT NOT NULL,
  fingerprint VARCHAR(128) NOT NULL,
  key_type VARCHAR(64) NOT NULL,
  approved_by VARCHAR(64) NOT NULL,
  approved_at DATETIME(6) NOT NULL,
  last_seen_at DATETIME(6) NOT NULL,
  PRIMARY KEY (workspace_id,host,port),
  KEY wc_remote_trust_actor (approved_by,approved_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wc_remote_checks (
  id CHAR(36) NOT NULL PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  actor_id VARCHAR(64) NOT NULL,
  target_json JSON NOT NULL,
  fingerprint VARCHAR(128) NOT NULL,
  inventory_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  consumed_at DATETIME(6) NULL,
  UNIQUE KEY wc_remote_checks_scope (workspace_id,id),
  KEY wc_remote_checks_expiry (workspace_id,expires_at),
  KEY wc_remote_checks_actor (workspace_id,actor_id,created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wc_remote_secrets (
  id CHAR(36) NOT NULL PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  check_id CHAR(36) NULL,
  review_id CHAR(36) NULL,
  job_id CHAR(36) NULL,
  purpose ENUM('ssh','settings') NOT NULL,
  ciphertext JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  cleared_at DATETIME(6) NULL,
  KEY wc_remote_secrets_expiry (workspace_id,expires_at,cleared_at),
  KEY wc_remote_secrets_check (workspace_id,check_id),
  KEY wc_remote_secrets_job (workspace_id,job_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wc_remote_reviews (
  id CHAR(36) NOT NULL PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  actor_id VARCHAR(64) NOT NULL,
  check_id CHAR(36) NOT NULL,
  target_json JSON NOT NULL,
  fingerprint VARCHAR(128) NOT NULL,
  inventory_json JSON NOT NULL,
  settings_json JSON NOT NULL,
  settings_secret_id CHAR(36) NOT NULL,
  approval_digest CHAR(64) NOT NULL,
  profile_id CHAR(36) NOT NULL,
  profile_revision INT NOT NULL,
  profile_snapshot_json JSON NOT NULL,
  profile_name VARCHAR(160) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  consumed_at DATETIME(6) NULL,
  KEY wc_remote_reviews_expiry (workspace_id,expires_at,consumed_at),
  KEY wc_remote_reviews_actor (workspace_id,actor_id,created_at),
  KEY wc_remote_reviews_digest (workspace_id,approval_digest)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wc_remote_jobs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  owner_id VARCHAR(64) NOT NULL,
  review_id CHAR(36) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  target_host VARCHAR(64) NOT NULL,
  target_port INT NOT NULL,
  target_json JSON NOT NULL,
  fingerprint VARCHAR(128) NOT NULL,
  expected_inventory_json JSON NOT NULL,
  settings_secret_id CHAR(36) NOT NULL,
  ssh_secret_id CHAR(36) NULL,
  label VARCHAR(120) NOT NULL,
  profile_name VARCHAR(160) NOT NULL,
  state ENUM('queued','connecting','checking','sending','launching','handed_off','blocked','connection_failed','launch_uncertain','cancelled') NOT NULL,
  error_code VARCHAR(64) NULL,
  command_id CHAR(36) NULL,
  group_id CHAR(36) NULL,
  run_id CHAR(36) NULL,
  dispatch_attempt INT NOT NULL DEFAULT 0,
  dispatch_intent_at DATETIME(6) NULL,
  lease_owner VARCHAR(128) NULL,
  lease_until DATETIME(6) NULL,
  deadline_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  handed_off_at DATETIME(6) NULL,
  terminal_at DATETIME(6) NULL,
  UNIQUE KEY wc_remote_jobs_idempotency (workspace_id,owner_id,idempotency_key),
  KEY wc_remote_jobs_claim (workspace_id,state,deadline_at,lease_until,created_at),
  KEY wc_remote_jobs_target (workspace_id,target_host,target_port,state),
  KEY wc_remote_jobs_owner (workspace_id,owner_id,created_at),
  KEY wc_remote_jobs_uncertain (workspace_id,state,updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wc_remote_job_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  job_id CHAR(36) NOT NULL,
  phase VARCHAR(32) NOT NULL,
  code VARCHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY wc_remote_job_events_job (workspace_id,job_id,id),
  KEY wc_remote_job_events_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wc_remote_worker_heartbeat (
  worker_id VARCHAR(128) NOT NULL PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL,
  heartbeat_at DATETIME(6) NOT NULL,
  queue_depth INT NOT NULL DEFAULT 0,
  oldest_queued_at DATETIME(6) NULL,
  updated_at DATETIME(6) NOT NULL,
  KEY wc_remote_worker_heartbeat_updated (updated_at)
) ENGINE=InnoDB;
