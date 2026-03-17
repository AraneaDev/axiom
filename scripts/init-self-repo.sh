#!/usr/bin/env bash
# init-self-repo.sh
#
# Creates or updates a bare clone of the Axiom source code inside the
# git_repos Docker volume so it is browsable within the app.
#
# Run this on the host before or after `npm run db:seed`.
#
# Usage:
#   ./scripts/init-self-repo.sh
#
# The script detects the volume mountpoint automatically via `docker volume
# inspect`. If REPOS_PATH is set it is used as the base directory instead.

set -euo pipefail

SOURCE_DIR="/root/axiom"

if [ ! -d "$SOURCE_DIR/.git" ]; then
  echo "ERROR: $SOURCE_DIR is not a git repository." >&2
  exit 1
fi

# Require at least one commit so the bare clone is non-empty.
if ! git -C "$SOURCE_DIR" rev-parse HEAD >/dev/null 2>&1; then
  echo "ERROR: $SOURCE_DIR has no commits yet. Commit the source code first." >&2
  exit 1
fi

# Determine the base path for repos.
if [ -n "${REPOS_PATH:-}" ]; then
  REPOS_BASE="$REPOS_PATH"
else
  # Try to resolve the Docker volume mountpoint on the host.
  MOUNTPOINT=$(docker volume inspect axiom_git_repos --format '{{.Mountpoint}}' 2>/dev/null || true)
  if [ -z "$MOUNTPOINT" ]; then
    echo "ERROR: Cannot determine repos path." >&2
    echo "       Either set REPOS_PATH or ensure the axiom_git_repos Docker volume exists." >&2
    exit 1
  fi
  REPOS_BASE="$MOUNTPOINT"
fi

DISK_PATH="$REPOS_BASE/axiom/core/axiom.git"

mkdir -p "$(dirname "$DISK_PATH")"

if [ -d "$DISK_PATH" ]; then
  echo "Updating bare clone at $DISK_PATH"
  git -C "$DISK_PATH" fetch "$SOURCE_DIR" --tags 2>/dev/null || true
else
  echo "Creating bare clone at $DISK_PATH"
  git clone --bare "$SOURCE_DIR" "$DISK_PATH"
fi

echo "Done: $DISK_PATH"
