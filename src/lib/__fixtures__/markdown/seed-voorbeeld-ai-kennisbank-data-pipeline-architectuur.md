# Data Pipeline Architectuur

## Overzicht

De data pipeline verwerkt documenten van ontvangst tot gestructureerde data:

```
Document Upload -> Preprocessing -> OCR/HTR -> Post-processing -> Validatie -> Opslag
```

## Componenten

### 1. Document Preprocessing
- Beeldkwaliteit verbeteren (deskew, contrast)
- Pagina segmentatie
- Taaldetectie

### 2. OCR/HTR Engine
- Azure Document Intelligence voor getypte tekst
- Custom HTR model voor handgeschreven tekst
- Confidence scoring per veld

### 3. Post-processing
- Named Entity Recognition (NER)
- Bedrag en datum normalisatie
- Adres validatie via PostNL API

### 4. Validatie
- Business rules engine
- Handmatige controle bij lage confidence
- Feedback loop naar model training

## Infrastructuur

- **Compute:** Azure Kubernetes Service
- **Queue:** Azure Service Bus
- **Storage:** Azure Blob Storage + PostgreSQL
- **Monitoring:** Grafana + Prometheus