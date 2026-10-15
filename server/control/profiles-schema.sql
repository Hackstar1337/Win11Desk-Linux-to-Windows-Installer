-- Additive deployment profile persistence. Profile input never contains credentials.
CREATE TABLE IF NOT EXISTS wc_profiles (
  id CHAR(36) NOT NULL PRIMARY KEY,
  workspace_id VARCHAR(64) NOT NULL DEFAULT 'default',
  name VARCHAR(160) NOT NULL,
  os_id VARCHAR(128) NOT NULL,
  iso_url TEXT NOT NULL,
  image_name VARCHAR(160) NOT NULL DEFAULT '',
  description VARCHAR(1000) NOT NULL DEFAULT '',
  username VARCHAR(20) NOT NULL DEFAULT 'Administrator',
  remote_port INT NOT NULL DEFAULT 22,
  retries INT NOT NULL DEFAULT 10,
  revision INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  archived_at DATETIME(3) NULL,
  UNIQUE KEY wc_profiles_workspace_name (workspace_id, name),
  KEY wc_profiles_workspace_archived (workspace_id, archived_at),
  CONSTRAINT wc_profiles_revision_positive CHECK (revision > 0),
  CONSTRAINT wc_profiles_remote_port_valid CHECK (remote_port BETWEEN 1 AND 65535),
  CONSTRAINT wc_profiles_retries_valid CHECK (retries BETWEEN 1 AND 20)
) ENGINE=InnoDB;

-- One current link per command; snapshot_json is the immutable run/deployment input.
CREATE TABLE IF NOT EXISTS wc_command_profiles (
  command_id CHAR(36) NOT NULL PRIMARY KEY,
  profile_id CHAR(36) NOT NULL,
  profile_revision INT NOT NULL,
  snapshot_json JSON NOT NULL,
  workspace_id VARCHAR(64) NOT NULL DEFAULT 'default',
  KEY wc_command_profiles_profile (workspace_id, profile_id, profile_revision),
  CONSTRAINT wc_command_profiles_revision_positive CHECK (profile_revision > 0),
  CONSTRAINT wc_command_profiles_profile_fk FOREIGN KEY (profile_id) REFERENCES wc_profiles(id)
) ENGINE=InnoDB;

-- Seed only the stable default row from existing settings. INSERT IGNORE preserves every
-- subsequent user edit, including archive state, name, URL, and revision.
INSERT IGNORE INTO wc_profiles
  (id,workspace_id,name,os_id,iso_url,image_name,description,username,remote_port,retries,revision,created_at,updated_at,archived_at)
SELECT
  '00000000-0000-4000-8000-000000000011',
  'default',
  'Default',
  'windows-11-pro',
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.settings_json,'$.isoUrl')),''),
  '',
  '',
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.settings_json,'$.username')),'Administrator'),
  COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(s.settings_json,'$.remotePort')) AS UNSIGNED),22),
  LEAST(20,GREATEST(1,COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(s.settings_json,'$.retries')) AS UNSIGNED),10))),
  1,
  UTC_TIMESTAMP(3),
  UTC_TIMESTAMP(3),
  NULL
FROM wc_settings s
WHERE s.workspace_id='default'
LIMIT 1;
