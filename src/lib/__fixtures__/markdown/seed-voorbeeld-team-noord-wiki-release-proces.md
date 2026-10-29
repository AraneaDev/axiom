# Release Proces

## Planning

1. Release candidate wordt aangemaakt op woensdag
2. QA test donderdag en vrijdag
3. Go/no-go beslissing vrijdag 16:00
4. Productie deployment maandag 06:00

## Checklist

- Alle tests slagen
- Code review goedgekeurd
- Release notes geschreven
- Stakeholders geinformeerd
- Rollback plan klaar

## Hotfix Proces

Bij kritieke bugs in productie:

1. Hotfix branch aanmaken vanuit `main`
2. Fix implementeren met tests
3. Versnelde review (1 reviewer voldoende)
4. Direct deployen naar productie
5. Terugmergen naar `develop`