-- Demo profiles for App Store and Google Play review. Timestamps use the column defaults
-- (integer ms). Re-running is a no-op.
--
-- Alex Rivera (DEMO_PROFILE_SLUG in @chatsoon/shared) is the second test profile reviewers scan,
-- or open at https://chatsoon.app/id/alex-rivera-demo to submit the Connect form. The reviewer
-- account is not connected to Alex, so the scan is a first connection.
--
-- Maya Lindqvist is the profile the reviewer account starts connected to (lib/reviewer.ts,
-- SAMPLE_CONNECTION_USER_ID), so report and block can be tried without affecting the scan.
INSERT OR IGNORE INTO `users` (`id`, `name`, `email`, `email_verified`)
VALUES ('usr_demo_alex', 'Alex Rivera', 'demo+alex@chatsoon.app', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `profiles` (`user_id`, `display_name`, `slug`, `headline`, `company`, `role`, `links`)
VALUES (
  'usr_demo_alex',
  'Alex Rivera',
  'alex-rivera-demo',
  'Partnerships at Northwind Labs',
  'Northwind Labs',
  'Head of Partnerships',
  '{"x":"chatsoonapp","website":"https://chatsoon.app"}'
);
--> statement-breakpoint
INSERT OR IGNORE INTO `users` (`id`, `name`, `email`, `email_verified`)
VALUES ('usr_demo_maya', 'Maya Lindqvist', 'demo+maya@chatsoon.app', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `profiles` (`user_id`, `display_name`, `slug`, `headline`, `company`, `role`, `links`)
VALUES (
  'usr_demo_maya',
  'Maya Lindqvist',
  'maya-lindqvist-demo',
  'Community at Contoso Events',
  'Contoso Events',
  'Community Lead',
  '{"x":"chatsoonapp","website":"https://chatsoon.app"}'
);
