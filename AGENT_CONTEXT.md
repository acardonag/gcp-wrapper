# GCP Services Agent Context

## Purpose

This repo contains the Cloud Run services that back the BBVA voice commerce demo.

It is split into two independent services:

- `ces-session-bridge/`: session orchestration, auth result storage, chat/result routing.
- `voice-commerce-bridge/`: product lookup, draft order creation, payment push, payment result finalization.
- `wrapper-channel/`: cloud-hosted wrapper backend, chat proxy, and session polling front door.
- `gemini-live-hello/`: minimal Gemini Live proof-of-concept that greets a user by cedula.

This repo is **not** the PWA frontend and is **not** the wrapper. It only hosts the server-side bridges.

## Topology

- `ces-session-bridge/server.mjs`
  - handles auth session state
  - exposes result polling for the wrapper
  - receives callbacks from BBVA demo approval flows

- `voice-commerce-bridge/server.mjs`
  - resolves product info
  - creates or reuses WooCommerce orders
  - sends payment pushes
  - stores purchase session state
  - exposes payment polling for the wrapper

- `wrapper-channel/server.mjs`
  - serves the wrapper PWA when packaged with assets
  - routes conversational chat to CES or other backends
  - exposes auth and purchase polling endpoints
  - can replace the local-only wrapper backend in Cloud Run

- `gemini-live-hello/server.mjs`
  - looks up the user by cedula from the existing commerce bridge
  - opens a Gemini Live session in text mode
  - returns a short greeting and proof that Live API is working

## Runtime flow

### Authentication

1. Wrapper sends cedula to CES bridge.
2. CES bridge checks Firestore / user state.
3. If `pagosInteligentes` is disabled, it returns a recommendation to activate it.
4. If enabled, it sends `AUTH_REQUEST` push to the BBVA demo.
5. BBVA demo approves biometrics and posts auth result back to CES.
6. Wrapper polls `session-result` until it sees auth completion.

### Purchase

1. Wrapper sends product selection to `voice-commerce-bridge`.
2. Bridge resolves the real product metadata from WooCommerce.
3. Bridge creates or reuses a WooCommerce order.
4. Bridge sends payment push to the BBVA demo.
5. BBVA demo approves payment and posts payment result back to the bridge.
6. Wrapper polls `purchase-result` until it sees `APROBADO`.

## Important state keys

- `sessionReplies`: auth and purchase session store.
- `purchaseLocks`: deduplication guard for repeated purchase intents.
- `purchaseFingerprintIndex`: idempotency index to avoid duplicate orders.
- `status: APROBADO`: final payment completion state.
- `status: PAYMENT_REQUESTED`: intermediate payment request state.

## Deployment

Deploy each service independently from its subdirectory:

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

## Failure modes to watch

- Auth state being reused during payment polling.
- Payment approval updating WooCommerce but not the same `sessionId`.
- Duplicate orders if purchase deduplication is not active.
- Missing CORS headers when testing approval flows from localhost.

## Operational notes

- Do not version secrets such as `firebase-key.json`.
- Keep the repo focused on bridge logic and deployment manifests.
- The wrapper should read auth from CES and payment from `voice-commerce-bridge`; never mix the two.
- `wrapper-channel` exists to move the wrapper backend out of localhost and into Cloud Run.
- `gemini-live-hello` is the smallest safe proof-of-concept for replacing the wrapper-generated conversational response with Gemini Live directly.
