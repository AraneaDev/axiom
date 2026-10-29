# Ontwikkelrichtlijnen

## Frontend Architectuur

Wij gebruiken een component-driven architectuur met:

- **React 18** met Server Components waar mogelijk
- **Tailwind CSS** voor styling
- **TanStack Query** voor server state management
- **Zustand** voor client state

## API Conventies

- RESTful endpoints met versioning (`/api/v2/...`)
- JSON:API response format
- Rate limiting op alle publieke endpoints
- OAuth 2.0 authenticatie

## Testing

- Unit tests: Vitest
- Integration tests: Supertest
- E2E tests: Playwright
- Visuele regressie: Chromatic