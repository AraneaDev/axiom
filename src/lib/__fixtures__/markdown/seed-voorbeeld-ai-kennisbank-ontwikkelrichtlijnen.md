# Ontwikkelrichtlijnen AI Team

## Model Development

- Gebruik MLflow voor experiment tracking
- Alle modellen geregistreerd in het model registry
- Minimaal 3 evaluatiemetrieken per model
- A/B testing verplicht voor productie updates

## Data Management

- Persoonlijke gegevens altijd pseudonimiseren
- Data versioning via DVC (Data Version Control)
- Training data opgeslagen in Azure Blob Storage
- Geen productie data in development omgevingen

## Code Kwaliteit

- Python: Black + Ruff formatter
- Type hints verplicht (mypy strict mode)
- Docstrings voor alle publieke functies
- Jupyter notebooks alleen voor exploratie, niet voor productie code