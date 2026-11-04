# Ontwikkelrichtlijnen

## Branching Strategie

Wij gebruiken Git Flow met de volgende branches:

- `main` - Productie code
- `develop` - Integratie branch
- `feature/*` - Nieuwe functionaliteit
- `hotfix/*` - Urgente fixes

## Code Review

Elke pull request vereist minimaal 1 goedkeuring. Reviews worden binnen 24 uur afgerond.

## Coding Standards

- TypeScript strict mode
- ESLint + Prettier configuratie
- Minimaal 80% code coverage
- Geen `any` types tenzij gedocumenteerd

## Deployment

Deployments gaan via de CI/CD pipeline. Alleen de `main` branch wordt naar productie gedeployed na goedkeuring.