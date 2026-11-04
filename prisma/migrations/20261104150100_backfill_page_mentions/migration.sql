-- Saves from the collaborative editor and page copies wrote bodies without their MENTION rows.
-- The same rule as extractIssueIdsFromContent: a key resolves in the page's own org, to an issue
-- the author can open. The author is whoever wrote the page's latest real version.
INSERT INTO "wiki_page_issue_links" ("id", "pageId", "issueId", "linkType", "createdById")
SELECT DISTINCT ON (p."id", i."id")
  gen_random_uuid()::text, p."id", i."id", 'MENTION'::"WikiIssueLinkType", author."authorId"
FROM "pages" p
JOIN "wiki_spaces" s ON s."id" = p."spaceId"
JOIN "teams" st ON st."id" = s."teamId"
CROSS JOIN LATERAL (
  SELECT v."authorId"
  FROM "page_versions" v
  WHERE v."pageId" = p."id" AND v."kind" <> 'SESSION_DRAFT'
  ORDER BY v."version" DESC
  LIMIT 1
) author
CROSS JOIN LATERAL regexp_matches(p."body", '\y([A-Z][A-Z0-9]+)-([0-9]{1,9})\y', 'g') AS m(parts)
JOIN "projects" pr ON pr."prefix" = m.parts[1]
JOIN "teams" pt ON pt."id" = pr."teamId" AND pt."orgId" = st."orgId"
JOIN "issues" i ON i."projectId" = pr."id" AND i."number" = m.parts[2]::int
WHERE EXISTS (SELECT 1 FROM "users" u WHERE u."id" = author."authorId" AND u."isAdmin")
   OR EXISTS (
     SELECT 1 FROM "team_memberships" tm
     WHERE tm."userId" = author."authorId" AND tm."teamId" = pr."teamId"
   )
ON CONFLICT DO NOTHING;
