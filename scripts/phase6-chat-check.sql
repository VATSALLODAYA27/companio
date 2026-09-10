-- Phase 6 verification: the Connection <-> Conversation <-> Message
-- relationships (Prisma-generated-client operations, not raw SQL, so
-- the primary verification is unit + e2e tests — this script proves
-- the DB-level constraints and cascades those tests can't reach
-- because they mock Prisma). Transactional, rolled back at the end.

BEGIN;

INSERT INTO users (id, email, status, "updatedAt") VALUES
  ('00000000-0000-0000-0000-000000000001', 'p6-a@test.local', 'ACTIVE', now()),
  ('00000000-0000-0000-0000-000000000002', 'p6-b@test.local', 'ACTIVE', now());

\echo '--- 1) accept-time shape: a Connection with sorted ids, then its Conversation ---'
INSERT INTO connections (id, "userAId", "userBId", "activityId")
SELECT '00000000-0000-0000-0000-0000000000c1',
       LEAST('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')::uuid,
       GREATEST('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')::uuid,
       id
FROM activities WHERE key = 'trekking';

INSERT INTO conversations (id, "connectionId")
VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1');

\echo '--- 2) a SECOND conversation for the same connection is rejected (Conversation.connectionId is @unique — true 1:1) ---'
DO $$
BEGIN
  INSERT INTO conversations (id, "connectionId")
  VALUES ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1');
  RAISE EXCEPTION 'expected a unique_violation but a second conversation for the same connection succeeded';
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'confirmed: conversations_connectionId_key enforces one Conversation per Connection';
END $$;

\echo '--- 3) messages persist and read back in sentAt order ---'
INSERT INTO messages (id, "conversationId", "senderId", body, "sentAt") VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1',
   '00000000-0000-0000-0000-000000000001', 'hey, still on for trekking saturday?', now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1',
   '00000000-0000-0000-0000-000000000002', 'yes! meeting point same as last time', now() - interval '1 minute');

SELECT "senderId", body FROM messages
  WHERE "conversationId" = '00000000-0000-0000-0000-0000000000d1'
  ORDER BY "sentAt" ASC;
-- expect: A's message first, then B's

\echo '--- 4) markRead-style update only touches the OTHER participant''s unread messages ---'
UPDATE messages SET "readAt" = now()
  WHERE "conversationId" = '00000000-0000-0000-0000-0000000000d1'
    AND "senderId" != '00000000-0000-0000-0000-000000000001'
    AND "readAt" IS NULL;
SELECT "senderId", "readAt" IS NOT NULL AS now_read FROM messages
  WHERE "conversationId" = '00000000-0000-0000-0000-0000000000d1' ORDER BY "sentAt" ASC;
-- expect: A's message unread (false), B's message read (true) — A marking
-- read only ever affects B's messages to A, never A's own

\echo '--- 5) cascade: removing the Connection row cascades to its Conversation and Messages ---'
DELETE FROM connections WHERE id = '00000000-0000-0000-0000-0000000000c1';
SELECT
  (SELECT count(*) FROM conversations WHERE id = '00000000-0000-0000-0000-0000000000d1') AS orphan_conversation,
  (SELECT count(*) FROM messages WHERE "conversationId" = '00000000-0000-0000-0000-0000000000d1') AS orphan_messages;
-- expect: 0, 0 -- NOTE: in the running app this path never actually
-- fires (unmatch is a soft delete via Connection.removedAt, never a row
-- DELETE — see ConnectionsService.removeConnection), so this proves the
-- schema's safety net works, not something the API relies on day-to-day.

ROLLBACK;
