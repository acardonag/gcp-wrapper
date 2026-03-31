import express from 'express';
import { GoogleAuth } from 'google-auth-library';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const app = express();

const port = process.env.PORT || 8080;
const projectId = process.env.GCP_PROJECT || 'team-blue-agents';
const location = process.env.CES_LOCATION || 'us';
const cesApp = process.env.CES_APP || `projects/${projectId}/locations/${location}/apps/4c1de0e5-214f-49fb-ab6b-d98773e942e9`;
const cesDeployment = process.env.CES_DEPLOYMENT || `${cesApp}/deployments/7285295e-facd-434e-a2cb-5722c29e873e`;
const cesVersion = process.env.CES_APP_VERSION || `${cesApp}/versions/737e65fa-7c1f-4be9-b1e5-abbcb58c57cf`;
const cesApiBase = process.env.CES_API_BASE || 'https://ces.googleapis.com/v1beta';
const corsOrigin = process.env.CORS_ORIGIN || '*';
const LOG_PREFIX = '[CesSessionBridge]';
const execFileAsync = promisify(execFile);
const sessionReplies = new Map();
const voiceCommerceBridgeUrl = (process.env.VOICE_COMMERCE_BRIDGE_URL || 'https://voice-commerce-bridge-1003987130329.us-central1.run.app').replace(/\/$/, '');

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform']
});

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const origin = corsOrigin === '*' ? (req.headers.origin || '*') : corsOrigin;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  console.log(`${LOG_PREFIX} ${req.method} ${req.url}`);
  next();
});

function sanitizeSessionId(sessionId) {
  const cleaned = String(sessionId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);

  return cleaned || '';
}

function extractCesReply(cesResponse) {
  return cesResponse?.outputs
    ?.map((output) => output?.text)
    ?.filter(Boolean)
    ?.join(' ')
    ?.trim() || '';
}

function stripEmojis(text) {
  return String(text || '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function lookupUserByCedula(cedula) {
  const normalizedCedula = String(cedula || '').replace(/\D/g, '');
  if (!normalizedCedula) return null;

  const response = await fetch(`${voiceCommerceBridgeUrl}/lookup-user?cedula=${encodeURIComponent(normalizedCedula)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  });

  const rawText = await response.text();
  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }

  console.log(`${LOG_PREFIX} lookup-user bridge result`, {
    ok: response.ok,
    status: response.status,
    cedula: normalizedCedula,
    found: Boolean(json?.found)
  });

  if (!response.ok) {
    throw new Error(json?.error || `No fue posible consultar la cédula en el bridge de compras. HTTP ${response.status}`);
  }

  return json?.found ? json?.user || null : null;
}

function isPagosInteligentesEnabled(userData = {}) {
  return Boolean(userData?.pagosInteligentes);
}

async function requestAuthPush({ cedula, sessionId, userName }) {
  const response = await fetch(`${voiceCommerceBridgeUrl}/request-auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      cedula,
      sessionId,
      userName
    })
  });

  const rawText = await response.text();
  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }

  console.log(`${LOG_PREFIX} request-auth bridge result`, {
    ok: response.ok,
    status: response.status,
    cedula,
    hasMessageId: Boolean(json?.messageId)
  });

  if (!response.ok) {
    throw new Error(json?.resultado || `No fue posible enviar la push de autenticación. HTTP ${response.status}`);
  }

  return json;
}

function buildAuthApprovedPrompt({ cedula, userName }) {
  return [
    'Evento del canal BBVA App.',
    'El usuario ya aprobo exitosamente la autenticacion en la app BBVA.',
    'La autenticacion ya quedo aprobada y confirmada.',
    'No vuelvas a pedir la cedula.',
    'Responde con un saludo personalizado al usuario usando su nombre si esta disponible.',
    'La respuesta final debe ser breve, amable y confirmar de forma explicita que la autenticacion fue aprobada.',
    'Luego invita de forma corta a continuar con la compra.',
    cedula ? `Cedula confirmada: ${cedula}.` : '',
    userName ? `Nombre confirmado: ${userName}.` : ''
  ].filter(Boolean).join(' ');
}

function buildAuthRejectedPrompt({ cedula, userName }) {
  return [
    'Evento del canal BBVA App.',
    'El usuario rechazo o no completo la autenticacion en la app BBVA.',
    'No continues con el flujo de compra.',
    'Informa de manera breve que la autenticacion no fue completada y que puede intentarlo nuevamente.',
    cedula ? `Cedula asociada: ${cedula}.` : '',
    userName ? `Nombre asociado: ${userName}.` : ''
  ].filter(Boolean).join(' ');
}

function buildPaymentApprovedPrompt({ orderId, productName, shippingAddress, shippingCity }) {
  return [
    'Evento del canal BBVA App.',
    'El usuario ya aprobo exitosamente el pago de la compra en la app BBVA.',
    'La orden ya fue creada y el pago quedo confirmado.',
    'No pidas de nuevo la cedula ni la confirmacion del pago.',
    orderId ? `Orden asociada: ${orderId}.` : '',
    productName ? `Producto confirmado: ${productName}.` : '',
    shippingAddress ? `Direccion de envio confirmada: ${shippingAddress}.` : '',
    shippingCity ? `Ciudad de envio confirmada: ${shippingCity}.` : '',
    'Responde de forma breve confirmando que el pago quedo aprobado y que seguira el proceso.'
  ].filter(Boolean).join(' ');
}

function buildPaymentRejectedPrompt({ orderId, productName }) {
  return [
    'Evento del canal BBVA App.',
    'El usuario rechazo o no completo el pago en la app BBVA.',
    'No completes la compra.',
    orderId ? `Orden asociada: ${orderId}.` : '',
    productName ? `Producto pendiente: ${productName}.` : '',
    'Responde de forma breve indicando que la compra no fue aprobada y que puede intentarlo de nuevo.'
  ].filter(Boolean).join(' ');
}

function buildPersonalizedAuthReply(userName) {
  const cleanName = String(userName || '').trim();
  const displayName = cleanName ? cleanName.split(/\s+/).slice(0, 2).join(' ') : 'Marcela';
  return stripEmojis(`Autenticación aprobada. Excelente, ${displayName}. ¿Qué deseas comprar ahora?`);
}

async function getAccessToken() {
  try {
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;

    if (token) {
      return token;
    }
  } catch (error) {
    console.warn(`${LOG_PREFIX} ADC token failed, trying gcloud fallback`, error.message);
  }

  try {
    const { stdout } = await execFileAsync('gcloud', ['auth', 'print-access-token'], {
      timeout: 10000
    });
    const token = stdout.trim();
    if (token) {
      return token;
    }
  } catch (error) {
    console.warn(`${LOG_PREFIX} gcloud fallback failed`, error.message);
  }

  throw new Error('No fue posible obtener access token para CES.');
}

async function runCesSession({ sessionId, text }) {
  const safeSessionId = sanitizeSessionId(sessionId);
  if (!safeSessionId) {
    throw new Error('sessionId es obligatorio.');
  }

  const session = `${cesApp}/sessions/${safeSessionId}`;
  const url = `${cesApiBase}/${session}:runSession`;
  const token = await getAccessToken();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      config: {
        session,
        app_version: cesVersion,
        deployment: cesDeployment
      },
      inputs: [
        {
          text
        }
      ]
    })
  });

  const rawText = await response.text();
  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }

  console.log(`${LOG_PREFIX} CES response`, {
    ok: response.ok,
    status: response.status,
    session
  });

  if (!response.ok) {
    throw new Error(`CES respondio HTTP ${response.status}: ${rawText}`);
  }

  return json;
}

app.post('/chat', async (req, res) => {
  try {
    const messageText = String(
      req.body?.message?.text ||
      req.body?.prompt ||
      req.body?.text ||
      ''
    ).trim();
    const sessionId = String(req.body?.sessionId || req.body?.clientSessionId || '').trim();

    if (!messageText) {
      res.status(400).json({ error: 'message.text, prompt o text es obligatorio.' });
      return;
    }
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId es obligatorio.' });
      return;
    }

    const cedulaDigits = messageText.replace(/\D/g, '');
    if (cedulaDigits && cedulaDigits.length >= 7 && cedulaDigits.length <= 12 && cedulaDigits === messageText.replace(/\s+/g, '')) {
      const userData = await lookupUserByCedula(cedulaDigits);
      console.log(`${LOG_PREFIX} cedula lookup`, {
        sessionId,
        cedula: cedulaDigits,
        found: Boolean(userData),
        userName: userData?.name || '',
        pagosInteligentes: isPagosInteligentesEnabled(userData)
      });

      if (!userData) {
        const replyText = 'Lo siento, no encontré una cuenta asociada a esa cédula.';
        sessionReplies.set(sanitizeSessionId(sessionId), {
          text: replyText,
          status: 'NO_ENCONTRADA',
          updatedAt: new Date().toISOString()
        });
        res.json({
          ok: true,
          sessionId,
          response: replyText,
          reply: replyText,
          text: replyText,
          cedulaLookup: {
            found: false
          }
        });
        return;
      }

      if (!isPagosInteligentesEnabled(userData)) {
        const replyText = stripEmojis('Tu cuenta existe, pero Pagos Inteligentes no está activado. Actívalo en la app BBVA para continuar.');
        sessionReplies.set(sanitizeSessionId(sessionId), {
          text: replyText,
          status: 'PI_DESACTIVADO',
          cedula: cedulaDigits,
          userName: userData.name || '',
          updatedAt: new Date().toISOString()
        });
        res.json({
          ok: true,
          sessionId,
          response: replyText,
          reply: replyText,
          text: replyText,
          cedulaLookup: {
            found: true,
            userName: userData.name || '',
            pagosInteligentes: false
          }
        });
        return;
      }

      const replyText = stripEmojis('Autenticación en proceso. Hemos enviado una solicitud de confirmación a tu App BBVA. Autoriza el acceso para continuar.');
      let authPush = null;
      try {
        authPush = await requestAuthPush({
          cedula: cedulaDigits,
          sessionId,
          userName: userData.name || ''
        });
      } catch (error) {
        console.warn(`${LOG_PREFIX} request-auth failed`, {
          sessionId,
          cedula: cedulaDigits,
          message: error?.message || String(error)
        });
      }

      sessionReplies.set(sanitizeSessionId(sessionId), {
        text: replyText,
        status: 'ENCONTRADA',
        cedula: cedulaDigits,
        userName: userData.name || '',
        authPush,
        updatedAt: new Date().toISOString()
      });
      res.json({
        ok: true,
        sessionId,
        response: replyText,
        reply: replyText,
        text: replyText,
        cedulaLookup: {
          found: true,
          userName: userData.name || '',
          pagosInteligentes: true
        },
        authPush
      });
      return;
    }

    const cesResponse = await runCesSession({
      sessionId,
      text: messageText
    });
    const replyText = extractCesReply(cesResponse);

    res.json({
      ok: true,
      sessionId,
      response: replyText,
      reply: replyText,
      text: replyText,
      cesResponse
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} chat error`, error);
    res.status(500).json({
      error: error?.message || 'No se pudo procesar el chat.'
    });
  }
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    cesApp,
    cesDeployment,
    cesVersion
  });
});

app.get('/session-result/:sessionId', (req, res) => {
  const sessionId = sanitizeSessionId(req.params.sessionId);
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId invalido.' });
    return;
  }

  const item = sessionReplies.get(sessionId);
  res.json({
    ok: true,
    found: Boolean(item),
    sessionId,
    result: item || null
  });
});

app.post('/auth-result', async (req, res) => {
  const {
    sessionId,
    status,
    cedula = '',
    userName = ''
  } = req.body || {};

  if (!sessionId || !status) {
    res.status(400).json({
      error: 'sessionId y status son obligatorios.'
    });
    return;
  }

  const normalizedStatus = String(status).toUpperCase();
  const text = normalizedStatus === 'APROBADO'
    ? buildAuthApprovedPrompt({ cedula, userName })
    : buildAuthRejectedPrompt({ cedula, userName });

  try {
    console.log(`${LOG_PREFIX} auth-result`, {
      sessionId,
      status: normalizedStatus,
      cedula,
      userName
    });

    const cesResponse = await runCesSession({
      sessionId,
      text
    });
    const cesReplyText = extractCesReply(cesResponse);
    const replyText = normalizedStatus === 'APROBADO'
      ? buildPersonalizedAuthReply(userName)
      : stripEmojis(cesReplyText);

    if (replyText) {
      sessionReplies.set(sanitizeSessionId(sessionId), {
        text: replyText,
        status: normalizedStatus,
        cedula,
        userName,
        updatedAt: new Date().toISOString()
      });
    }

    res.json({
      ok: true,
      forwarded: true,
      sessionId,
      status: normalizedStatus,
      replyText,
      cesResponse,
      cesReplyText
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} auth-result error`, error);
    res.status(500).json({
      error: error?.message || 'No se pudo notificar a CES.'
    });
  }
});

app.post('/payment-result', async (req, res) => {
  const {
    sessionId,
    status,
    orderId = '',
    productName = '',
    shippingAddress = '',
    shippingCity = ''
  } = req.body || {};

  if (!sessionId || !status) {
    res.status(400).json({
      error: 'sessionId y status son obligatorios.'
    });
    return;
  }

  const normalizedStatus = String(status).toUpperCase();
  const text = normalizedStatus === 'APROBADO'
    ? buildPaymentApprovedPrompt({ orderId, productName, shippingAddress, shippingCity })
    : buildPaymentRejectedPrompt({ orderId, productName });

  try {
    console.log(`${LOG_PREFIX} payment-result`, {
      sessionId,
      status: normalizedStatus,
      orderId,
      productName
    });

    const cesResponse = await runCesSession({
      sessionId,
      text
    });
    const replyText = stripEmojis(extractCesReply(cesResponse));

    if (replyText) {
      sessionReplies.set(sanitizeSessionId(sessionId), {
        text: replyText,
        status: normalizedStatus,
        orderId,
        productName,
        updatedAt: new Date().toISOString()
      });
    }

    res.json({
      ok: true,
      forwarded: true,
      sessionId,
      status: normalizedStatus,
      replyText,
      cesResponse
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} payment-result error`, error);
    res.status(500).json({
      error: error?.message || 'No se pudo notificar el resultado de pago a CES.'
    });
  }
});

app.listen(port, () => {
  console.log(`${LOG_PREFIX} listening`, {
    port,
    cesApp,
    cesDeployment,
    cesVersion
  });
});
