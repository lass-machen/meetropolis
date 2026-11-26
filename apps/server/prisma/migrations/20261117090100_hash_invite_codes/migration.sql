-- Invite codes are no longer stored in plaintext: the "code" column now
-- holds the SHA-256 hex of the raw invite code, and lookups hash the
-- presented code before comparing. Rewriting the existing values in place
-- keeps invitation links that were already sent valid, because the raw code
-- in such a link hashes to the value stored by this update.
UPDATE "Invite" SET "code" = encode(sha256(convert_to("code", 'UTF8')), 'hex');
