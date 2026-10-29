# API Standaarden

## Naamgeving

- Endpoints in kebab-case: `/api/v2/order-lines`
- Query parameters in camelCase: `?pageSize=20&sortBy=createdAt`
- Request/response body in camelCase

## Foutafhandeling

Alle errors volgen dit format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Beschrijving van de fout",
    "details": []
  }
}
```

## Paginering

Cursor-based paginering voor alle lijst endpoints:

```
GET /api/v2/orders?cursor=abc123&limit=20
```

## Versioning

- Major versie in URL pad (`/api/v2/`)
- Breaking changes alleen bij major versie update
- Minimaal 6 maanden deprecation period