# GCP Services

Repositorio separado para los servicios que corren en Cloud Run.

## Contenido

- `ces-session-bridge/`: puente de autenticacion y seguimiento de sesion.
- `voice-commerce-bridge/`: puente de compras, push de pago y estados de orden.

## Relacion con los otros repos

- `wrapper`: canal de voz y orquestacion local.
- `blue-agents-demo`: demo BBVA/PWA y pantalla de aprobacion.

## Despliegue

Desde la raiz de este repo:

```bash
gcloud run deploy ces-session-bridge \
  --source /Users/C810865/Documents/W/CODEX_BLUE_AGENTS/gcp/ces-session-bridge \
  --region us-central1 \
  --allow-unauthenticated \
  --project team-blue-agents
```

```bash
gcloud run deploy voice-commerce-bridge \
  --source /Users/C810865/Documents/W/CODEX_BLUE_AGENTS/gcp/voice-commerce-bridge \
  --region us-central1 \
  --allow-unauthenticated \
  --project team-blue-agents
```

## Nota

No versionar credenciales locales como `firebase-key.json`.
