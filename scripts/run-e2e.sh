#!/usr/bin/env bash
set -e

echo "Switching API to E2E database..."
docker compose -f docker-compose.dev.yml -f docker-compose.e2e.yml up -d api worker

echo "Waiting for API to be healthy..."
until docker compose -f docker-compose.dev.yml exec -T api wget -qO- http://localhost:3000/api/health > /dev/null 2>&1; do
  sleep 1
done

# Run Playwright tests (pass through any extra args)
npx playwright test "$@"
EXIT_CODE=$?

echo "Restoring API to dev database..."
docker compose -f docker-compose.dev.yml up -d api worker

exit $EXIT_CODE
