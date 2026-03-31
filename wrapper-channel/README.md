# Wrapper Channel

Servicio Cloud Run que expone el backend del canal de voz del wrapper.

Este servicio:

- sirve la PWA del wrapper si se empaqueta con sus assets;
- enruta el chat hacia el backend configurado;
- separa `session-result` y `purchase-result`;
- soporta Gemini local, CES bridge, HTTP JSON y webhook n8n.

Para producción, este backend debe desplegarse junto con una PWA pública o con assets servidos por el mismo dominio.
