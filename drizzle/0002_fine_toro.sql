CREATE TABLE `installerTrackingGroups` (
	`id` varchar(36) NOT NULL,
	`readTokenHash` varchar(64) NOT NULL,
	`writeTokenHash` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `installerTrackingGroups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `installerTrackingRuns` (
	`id` varchar(36) NOT NULL,
	`groupId` varchar(36) NOT NULL,
	`reportTokenHash` varchar(64) NOT NULL,
	`hostname` varchar(253) NOT NULL,
	`wholeDisk` varchar(128) NOT NULL,
	`rdpPort` int NOT NULL,
	`publicIP` varchar(45),
	`windowsEdition` varchar(64),
	`windowsBuild` int,
	`rdpListening` boolean,
	`stage` varchar(32) NOT NULL DEFAULT 'starting',
	`sequence` int NOT NULL DEFAULT 0,
	`errorStage` enum('starting','preflight','staging','rebooting','installer_booted','downloading','media_verified','preparing','windows_setup','windows_booted','windows_ready'),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `installerTrackingRuns_id` PRIMARY KEY(`id`)
);
