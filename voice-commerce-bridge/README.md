# Voice Commerce Bridge

Servicio para el flujo de checkout por voz:

- crea una orden draft en Woo Store API;
- obtiene los datos de envio del usuario desde Firestore;
- envia el push `ORDER_PAYMENT_REQUEST` a la app demo BBVA.

Este servicio espera un archivo local `firebase-key.json` para el despliegue.
