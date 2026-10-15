CREATE TABLE `installerTickets` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`secretHash` varchar(64) NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` varchar(32) NOT NULL,
	`tag` varchar(32) NOT NULL,
	`scriptHash` varchar(64) NOT NULL,
	`downloads` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `installerTickets_id` PRIMARY KEY(`id`)
);
