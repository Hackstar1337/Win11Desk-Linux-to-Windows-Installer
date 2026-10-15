CREATE TABLE IF NOT EXISTS wc_delivery_secrets(command_id CHAR(36) PRIMARY KEY,input_digest CHAR(64) NOT NULL,capability_envelope TEXT NOT NULL) ENGINE=InnoDB;
