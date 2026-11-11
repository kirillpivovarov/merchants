CREATE TABLE `workspace_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`payload` text NOT NULL
);
