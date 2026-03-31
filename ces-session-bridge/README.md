# CES Session Bridge

Bridge HTTP para reenviar eventos de la app BBVA hacia una sesion viva de CES.

## Endpoint principal

- `POST /auth-result`

Payload:

```json
{
  "sessionId": "smart-wrapper-123",
  "status": "APROBADO",
  "cedula": "12345678",
  "userName": "Ana Perez"
}
```

## Variables

- `CES_APP`
- `CES_DEPLOYMENT`
- `CES_APP_VERSION`
- `CES_LOCATION`
- `GCP_PROJECT`
- `CORS_ORIGIN`

## Desarrollo local

```bash
cd /Users/C810865/Documents/W/CODEX_BLUE_AGENTS/gcp/ces-session-bridge
npm install
npm start
```

## Despliegue sugerido en Cloud Run

```bash
gcloud run deploy ces-session-bridge \
  --source /Users/C810865/Documents/W/CODEX_BLUE_AGENTS/gcp/ces-session-bridge \
  --region us-central1 \
  --allow-unauthenticated
```
