-- Token scopes per area: rewrite the four old scope names so each stored token reaches
-- exactly what it reached before. Same table as LEGACY_SCOPE_MAP in
-- src/middleware/token-scopes.ts. Any other stored value never did anything; several of them
-- are live scope names from now on, so they are dropped rather than carried over.
UPDATE "api_tokens" AS t
SET "scopes" = ARRAY(
  SELECT DISTINCT m.new_scope
  FROM unnest(t."scopes") AS stored(old_scope)
  JOIN (
    VALUES
      ('issues:read', 'issues:read'),
      ('issues:read', 'sprints:read'),
      ('issues:read', 'boards:read'),
      ('issues:read', 'projects:read'),
      ('issues:read', 'forms:read'),
      ('issues:read', 'automation:read'),
      ('issues:read', 'approvals:read'),
      ('issues:read', 'dashboards:read'),
      ('issues:read', 'files:read'),
      ('issues:read', 'search:read'),
      ('issues:read', 'orgs:read'),
      ('issues:read', 'teams:read'),
      ('issues:write', 'issues:write'),
      ('issues:write', 'sprints:write'),
      ('issues:write', 'boards:write'),
      ('issues:write', 'projects:read'),
      ('issues:write', 'forms:write'),
      ('issues:write', 'automation:write'),
      ('issues:write', 'approvals:write'),
      ('issues:write', 'dashboards:read'),
      ('issues:write', 'files:write'),
      ('issues:write', 'search:read'),
      ('issues:write', 'orgs:read'),
      ('issues:write', 'teams:read'),
      ('wiki:read', 'wiki:read'),
      ('wiki:read', 'files:read'),
      ('wiki:read', 'search:read'),
      ('wiki:read', 'orgs:read'),
      ('wiki:read', 'teams:read'),
      ('wiki:write', 'wiki:write'),
      ('wiki:write', 'files:write'),
      ('wiki:write', 'search:read'),
      ('wiki:write', 'orgs:read'),
      ('wiki:write', 'teams:read')
  ) AS m(old_scope, new_scope) ON m.old_scope = stored.old_scope
);
