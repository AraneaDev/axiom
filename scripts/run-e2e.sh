#!/usr/bin/env bash
set -e

restore() {
  echo "Restoring API to dev database..."
  docker compose -f docker-compose.dev.yml up -d api worker
}
trap restore EXIT

echo "Ensuring E2E database exists..."
docker compose -f docker-compose.dev.yml up -d db
until docker compose -f docker-compose.dev.yml exec -T db pg_isready -U axiom > /dev/null 2>&1; do
  sleep 1
done
if ! docker compose -f docker-compose.dev.yml exec -T db psql -U axiom -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = 'axiom_e2e'" | grep -q 1; then
  docker compose -f docker-compose.dev.yml exec -T db psql -U axiom -d postgres \
    -c "CREATE DATABASE axiom_e2e OWNER axiom"
fi

echo "Switching API to E2E database..."
docker compose -f docker-compose.dev.yml -f docker-compose.e2e.yml up -d api worker

echo "Waiting for API to be healthy..."
until docker compose -f docker-compose.dev.yml exec -T api wget -qO- http://localhost:3000/api/health > /dev/null 2>&1; do
  sleep 1
done

# Run Playwright tests (pass through any extra args)
set +e
npx playwright test "$@"
EXIT_CODE=$?
set -e

exit $EXIT_CODE
