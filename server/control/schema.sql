CREATE TABLE IF NOT EXISTS wc_accounts (
 id VARCHAR(64) PRIMARY KEY, email VARCHAR(320) NOT NULL, name VARCHAR(160) NOT NULL, password_hash VARCHAR(512) NOT NULL, role ENUM('owner','admin','operator','viewer') NOT NULL DEFAULT 'viewer', active TINYINT NOT NULL DEFAULT 1, mfa_enabled TINYINT NOT NULL DEFAULT 0, mfa_last_step BIGINT NULL, mfa_secret_envelope TEXT NULL, mfa_pending_envelope TEXT NULL, mfa_pending_expires DATETIME(6) NULL, bootstrap_digest CHAR(64) NULL, last_login_at DATETIME(6) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE KEY wc_email(email), UNIQUE KEY wc_bootstrap(bootstrap_digest)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS wc_sessions (
 id VARCHAR(64) PRIMARY KEY, account_id VARCHAR(64) NOT NULL, token_digest CHAR(64) NOT NULL, csrf_token CHAR(64) NOT NULL, user_agent VARCHAR(512) NULL, ip_address VARCHAR(128) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), last_seen_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), expires_at DATETIME(6) NOT NULL, step_up_at DATETIME(6) NULL, revoked_at DATETIME(6) NULL, UNIQUE KEY wc_token(token_digest), KEY wc_session_account(account_id), FOREIGN KEY(account_id) REFERENCES wc_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS wc_auth_limits (
 key_type VARCHAR(32) NOT NULL, key_value CHAR(64) NOT NULL, failures INT NOT NULL DEFAULT 0, window_started_at DATETIME(6) NOT NULL, blocked_until DATETIME(6) NULL, PRIMARY KEY(key_type,key_value)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS wc_invites (
 id VARCHAR(64) PRIMARY KEY,email VARCHAR(320) NOT NULL,role ENUM('admin','operator','viewer') NOT NULL,token_hash CHAR(64) NOT NULL,invited_by VARCHAR(64) NOT NULL,expires_at DATETIME(6) NOT NULL,accepted_at DATETIME(6) NULL,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),UNIQUE KEY wc_invite_token(token_hash)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS wc_recovery (
 id VARCHAR(64) PRIMARY KEY,account_id VARCHAR(64) NOT NULL,code_hash CHAR(64) NOT NULL,used_at DATETIME(6) NULL,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),KEY wc_recovery_account(account_id),FOREIGN KEY(account_id) REFERENCES wc_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS wc_audit (
 id VARCHAR(64) PRIMARY KEY,actor_id VARCHAR(64) NULL,action VARCHAR(120) NOT NULL,target_id TEXT NULL,metadata_json JSON NULL,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),KEY wc_audit_created(created_at)
) ENGINE=InnoDB;
