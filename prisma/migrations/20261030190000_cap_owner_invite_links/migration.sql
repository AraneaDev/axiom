-- OWNER invite links minted by someone who is not an OWNER of the org (possible before
-- grants were capped at the granter's role) are downgraded to ADMIN. Redemption also caps
-- the role at the creator's current role.
UPDATE "invite_links" il
SET "role" = 'ADMIN'
WHERE il."role" = 'OWNER'
  AND NOT EXISTS (
    SELECT 1 FROM "org_memberships" om
    WHERE om."orgId" = il."orgId" AND om."userId" = il."createdBy" AND om."role" = 'OWNER'
  );
