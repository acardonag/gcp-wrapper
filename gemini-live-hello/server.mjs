import express from 'express';
import { GoogleGenAI } from '@google/genai';

const app = express();

const port = process.env.PORT || 8080;
const apiKey = process.env.GEMINI_API_KEY;
const liveModel = process.env.GEMINI_LIVE_MODEL || 'gemini-live-2.5-flash-preview';
const voiceCommerceBridgeUrl = (process.env.VOICE_COMMERCE_BRIDGE_URL || 'https://voice-commerce-bridge-1003987130329.us-central1.run.app').replace(/\/$/, '');
const LOG_PREFIX = '[GeminiLiveHello]';

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  console.log(`${LOG_PREFIX} ${req.method} ${req.url}`);
  next();
});

function sanitizeCedula(cedula) {
  return String(cedula || '').replace(/\D/g, '').slice(0, 16);
}

async function lookupUser(cedula) {
  const normalizedCedula = sanitizeCedula(cedula);
  if (!normalizedCedula) {
    throw new Error('cedula es obligatoria.');
  }

  const response = await fetch(`${voiceCommerceBridgeUrl}/lookup-user?cedula=${encodeURIComponent(normalizedCedula)}`);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error || `lookup-user respondio HTTP ${response.status}.`);
  }

  return payload?.found ? payload.user : null;
}

async function liveHello({ cedula, userName }) {
  if (!apiKey) {
    throw new Error('Falta GEMINI_API_KEY.');
  }

  const ai = new GoogleGenAI({ apiKey });
  let resolveReply;
  let rejectReply;
  let textBuffer = '';

  const replyPromise = new Promise((resolve, reject) => {
    resolveReply = resolve;
    rejectReply = reject;
  });

  const session = await ai.live.connect({
    model: liveModel,
    config: {
      responseModalities: ['text']
    },
    callbacks: {
      onopen: () => console.log(`${LOG_PREFIX} live socket open`),
      onmessage: (event) => {
        const text = event?.text || '';
        if (text) {
          textBuffer += text;
        }

        console.log(`${LOG_PREFIX} live message`, {
          text,
          turnCompleteReason: event?.serverContent?.turnCompleteReason || null
        });

        const turnCompleteReason = event?.serverContent?.turnCompleteReason;
        if (turnCompleteReason || textBuffer) {
          resolveReply?.(textBuffer.trim());
          resolveReply = null;
          rejectReply = null;
        }
      },
      onerror: (event) => {
        console.error(`${LOG_PREFIX} live error`, event?.error || event);
        rejectReply?.(event?.error || new Error('Live session error.'));
        resolveReply = null;
        rejectReply = null;
      },
      onclose: () => {
        console.log(`${LOG_PREFIX} live socket closed`);
        resolveReply?.(textBuffer.trim());
        resolveReply = null;
        rejectReply = null;
      }
    }
  });

  session.sendClientContent({
    turns: [
      {
        role: 'user',
        parts: [
          {
            text: [
              'Responde en espanol, sin markdown, en una sola frase breve.',
              'Saluda al usuario de forma amigable.',
              'Confirma que la cédula fue recibida.',
              cedula ? `Cedula: ${cedula}.` : '',
              userName ? `Nombre: ${userName}.` : ''
            ].filter(Boolean).join(' ')
          }
        ]
      }
    ],
    turnComplete: true
  });

  const reply = await replyPromise;
  session.close();
  return reply || `Hola ${userName || 'usuario'}. Cédula ${cedula} recibida.`;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasGeminiKey: Boolean(apiKey),
    liveModel,
    voiceCommerceBridgeUrl
  });
});

app.post('/api/hello', async (req, res) => {
  try {
    const cedula = sanitizeCedula(req.body?.cedula);
    if (!cedula) {
      res.status(400).json({ error: 'cedula es obligatoria.' });
      return;
    }

    const user = await lookupUser(cedula);
    const userName = user?.name || user?.userName || user?.nombre || '';
    const reply = await liveHello({ cedula, userName });

    res.json({
      cedula,
      userName,
      response: reply
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} hello error`, error);
    res.status(500).json({
      error: error?.message || 'No se pudo generar el saludo.'
    });
  }
});

app.get('*', (_req, res) => {
  res.json({
    ok: true,
    message: 'Use POST /api/hello with a cedula.'
  });
});

app.listen(port, () => {
  console.log(`${LOG_PREFIX} listening`, {
    port,
    liveModel,
    hasGeminiKey: Boolean(apiKey)
  });
});
