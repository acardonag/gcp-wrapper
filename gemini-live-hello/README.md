# Gemini Live Hello

Demo minimo que usa Gemini Live para saludar a un usuario identificado por cedula.

Flujo:

1. Recibe una cedula.
2. Consulta el backend de usuarios ya existente en GCP.
3. Abre una sesion Gemini Live en modo texto.
4. Gemini Live devuelve un saludo corto y personalizado.

## Endpoint

- `POST /api/hello`

Payload:

```json
{ "cedula": "1053798698" }
```

## Variables de entorno

- `GEMINI_API_KEY`
- `GEMINI_LIVE_MODEL` opcional, default `gemini-live-2.5-flash-preview`
- `VOICE_COMMERCE_BRIDGE_URL` opcional, default al bridge actual

