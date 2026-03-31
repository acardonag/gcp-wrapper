import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent as UndiciAgent } from 'undici';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_PREFIX = '[VoiceCommerceBridge]';
const app = express();

const port = Number(process.env.PORT || 8080);
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || 'team-blue-agents';
const firebaseKeyPath = process.env.FIREBASE_KEY_PATH || path.join(__dirname, 'firebase-key.json');
const preferApplicationDefault = process.env.FIREBASE_USE_ADC !== 'false';
const wooBaseUrl = (process.env.WOO_STORE_API_BASE || 'https://lightcyan-mule-502433.hostingersite.com/wp-json/wc/store/v1').replace(/\/$/, '');
const wooRestApiBase = (process.env.WOO_REST_API_BASE || wooBaseUrl.replace(/\/wp-json\/wc\/store\/v1$/, '/wp-json/wc/v3')).replace(/\/$/, '');
const wooConsumerKey = process.env.WOO_CONSUMER_KEY || '';
const wooConsumerSecret = process.env.WOO_CONSUMER_SECRET || '';
const wooConsumerKeyLightcyan = process.env.WOO_CONSUMER_KEY_LIGHTCYAN || '';
const wooConsumerSecretLightcyan = process.env.WOO_CONSUMER_SECRET_LIGHTCYAN || '';
const wooConsumerKeySteelblue = process.env.WOO_CONSUMER_KEY_STEELBLUE || '';
const wooConsumerSecretSteelblue = process.env.WOO_CONSUMER_SECRET_STEELBLUE || '';
const notificationIcon = process.env.NOTIFICATION_ICON || 'https://acardonag.github.io/blue-agents-demo/icono-pwa.png';
const allowInsecureTls = process.env.ALLOW_INSECURE_TLS !== 'false';
const sessionReplies = new Map();
const purchaseLocks = new Map();
const purchaseFingerprintIndex = new Map();
if (allowInsecureTls) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
const insecureDispatcher = allowInsecureTls
  ? new UndiciAgent({
      connect: {
        rejectUnauthorized: false
      }
    })
  : undefined;

const STORE_DEFINITIONS = [
  {
    storeId: 'woocommerce-lightcyan',
    displayName: 'WooCommerce Lightcyan',
    hintTokens: ['lightcyan', 'light cyan', 'mule', '502433'],
    baseUrl: 'https://lightcyan-mule-502433.hostingersite.com/wp-json/wc/store/v1',
    restApiBase: 'https://lightcyan-mule-502433.hostingersite.com/wp-json/wc/v3',
    consumerKey: wooConsumerKeyLightcyan || wooConsumerKey,
    consumerSecret: wooConsumerSecretLightcyan || wooConsumerSecret
  },
  {
    storeId: 'woocommerce-steelblue',
    displayName: 'WooCommerce Steelblue',
    hintTokens: ['steelblue', 'steel blue', 'woodpecker', '587951'],
    baseUrl: 'https://steelblue-woodpecker-587951.hostingersite.com/wp-json/wc/store/v1',
    restApiBase: 'https://steelblue-woodpecker-587951.hostingersite.com/wp-json/wc/v3',
    consumerKey: wooConsumerKeySteelblue || wooConsumerKey,
    consumerSecret: wooConsumerSecretSteelblue || wooConsumerSecret
  }
];

function normalizeStoreHint(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function resolveStoreDefinition(storeHint = '') {
  const normalizedHint = normalizeStoreHint(storeHint);
  const matched = STORE_DEFINITIONS.find((store) =>
    store.hintTokens.some((token) => normalizedHint.includes(token))
  );

  if (matched) {
    return matched;
  }

  const normalizedDefaultBase = normalizeStoreHint(wooBaseUrl);
  if (normalizedDefaultBase.includes('steelblue')) {
    return STORE_DEFINITIONS[1];
  }

  return STORE_DEFINITIONS[0];
}

const DEPARTMENT_TO_STATE = new Map([
  ['amazonas', 'CO-AMA'],
  ['antioquia', 'CO-ANT'],
  ['arauca', 'CO-ARA'],
  ['atlantico', 'CO-ATL'],
  ['atlantico ', 'CO-ATL'],
  ['bolivar', 'CO-BOL'],
  ['boyaca', 'CO-BOY'],
  ['caldas', 'CO-CAL'],
  ['caqueta', 'CO-CAQ'],
  ['casanare', 'CO-CAS'],
  ['cauca', 'CO-CAU'],
  ['cesar', 'CO-CES'],
  ['choco', 'CO-CHO'],
  ['cordoba', 'CO-COR'],
  ['cundinamarca', 'CO-CUN'],
  ['bogota d.c.', 'CO-DC'],
  ['bogota dc', 'CO-DC'],
  ['bogota', 'CO-DC'],
  ['guainia', 'CO-GUA'],
  ['guaviare', 'CO-GUV'],
  ['huila', 'CO-HUI'],
  ['la guajira', 'CO-LAG'],
  ['magdalena', 'CO-MAG'],
  ['meta', 'CO-MET'],
  ['narino', 'CO-NAR'],
  ['nariño', 'CO-NAR'],
  ['norte de santander', 'CO-NSA'],
  ['putumayo', 'CO-PUT'],
  ['quindio', 'CO-QUI'],
  ['quindío', 'CO-QUI'],
  ['risaralda', 'CO-RIS'],
  ['santander', 'CO-SAN'],
  ['san andres y providencia', 'CO-SAP'],
  ['sucre', 'CO-SUC'],
  ['tolima', 'CO-TOL'],
  ['valle del cauca', 'CO-VAC'],
  ['vaupes', 'CO-VAU'],
  ['vaupés', 'CO-VAU'],
  ['vichada', 'CO-VID']
]);

const CITY_TO_STATE = new Map([
  ['bogota', 'CO-DC'],
  ['bogotá', 'CO-DC'],
  ['medellin', 'CO-ANT'],
  ['medellín', 'CO-ANT'],
  ['cali', 'CO-VAC'],
  ['barranquilla', 'CO-ATL'],
  ['cartagena', 'CO-BOL'],
  ['bucaramanga', 'CO-SAN'],
  ['pereira', 'CO-RIS'],
  ['manizales', 'CO-CAL'],
  ['ibague', 'CO-TOL'],
  ['ibagué', 'CO-TOL'],
  ['cucuta', 'CO-NSA'],
  ['cúcuta', 'CO-NSA']
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function buildStateCode(deliveryData = {}) {
  const department = normalizeText(deliveryData.department);
  const city = normalizeText(deliveryData.city);
  return DEPARTMENT_TO_STATE.get(department) || CITY_TO_STATE.get(city) || 'CO-DC';
}

function buildPostcode(deliveryData = {}) {
  const city = normalizeText(deliveryData.city);
  if (city === 'bogota' || city === 'bogota d.c.' || city === 'bogota dc') {
    return '110111';
  }
  return String(deliveryData.postcode || '000000');
}

function stringValue(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function isPagosInteligentesEnabled(userData = {}) {
  return Boolean(userData?.pagosInteligentes);
}

function buildPiDisabledResponse(userData, cedula) {
  const replyText = 'Tu cuenta existe, pero Pagos Inteligentes no está activado. Actívalo en la app BBVA para continuar.';
  return {
    ok: true,
    resultado: replyText,
    cedula: String(cedula || '').replace(/\D/g, ''),
    userName: userData?.name || '',
    pagosInteligentes: false
  };
}

function parsePriceToString(price) {
  const numeric = Number(price || 0);
  if (Number.isNaN(numeric) || numeric <= 0) {
    return '';
  }
  return String(Math.round(numeric));
}

function sanitizeSessionId(sessionId) {
  return String(sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
}

function buildPurchaseFingerprint({ cedula, productId, storeId, amount, shipping }) {
  return [
    String(cedula || '').replace(/\D/g, ''),
    String(productId || '').trim(),
    String(storeId || '').trim(),
    String(amount || '').trim(),
    String(shipping?.address || '').trim(),
    String(shipping?.city || '').trim()
  ].join('|');
}

async function ensureFirebase() {
  if (!admin.apps.length) {
    const fs = await import('node:fs/promises');
    let credential;
    if (preferApplicationDefault) {
      try {
        credential = admin.credential.applicationDefault();
        console.log(`${LOG_PREFIX} Using application default credentials`);
      } catch (error) {
        console.warn(`${LOG_PREFIX} ADC not available, falling back to key file`, error.message);
      }
    }

    if (!credential) {
      try {
        await fs.access(firebaseKeyPath);
        const serviceAccountModule = await import(firebaseKeyPath, { with: { type: 'json' } });
        credential = admin.credential.cert(serviceAccountModule.default);
        console.log(`${LOG_PREFIX} Using service account key from ${firebaseKeyPath}`);
      } catch (error) {
        throw new Error(`No fue posible inicializar Firebase Admin: ${error.message}`);
      }
    }

    admin.initializeApp({ credential, projectId: firebaseProjectId });
  }
}

async function readUser(cedula) {
  await ensureFirebase();
  const snapshot = await admin.firestore().collection('users').doc(String(cedula)).get();
  if (!snapshot.exists) {
    return null;
  }
  return snapshot.data();
}

function extractHeaders(response) {
  return {
    nonce: response.headers.get('Nonce') || '',
    cartToken: response.headers.get('Cart-Token') || ''
  };
}

async function wooRequest(endpoint, { method = 'GET', nonce = '', cartToken = '', body } = {}, storeHint = '') {
  const headers = {};
  if (nonce) headers.Nonce = nonce;
  if (cartToken) headers['Cart-Token'] = cartToken;
  if (body) headers['Content-Type'] = 'application/json';
  const storeDefinition = resolveStoreDefinition(storeHint);

  const response = await fetch(`${storeDefinition.baseUrl}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    dispatcher: insecureDispatcher
  });

  const rawText = await response.text();
  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    throw new Error(`Woo Store API ${method} ${endpoint} fallo con HTTP ${response.status}: ${rawText}`);
  }

  return {
    json,
    headers: extractHeaders(response)
  };
}

function wooRestAuthHeaders() {
  const headers = {};
  const creds = getWooCredentialsForStore(wooBaseUrl);
  if (creds.consumerKey && creds.consumerSecret) {
    const token = Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  }
  return headers;
}

function getWooCredentialsForStore(baseUrl) {
  const definition = resolveStoreDefinition(baseUrl);
  return {
    consumerKey: definition.consumerKey,
    consumerSecret: definition.consumerSecret
  };
}

function hasWooCredentialsForStore(baseUrl) {
  const creds = getWooCredentialsForStore(baseUrl);
  return Boolean(creds.consumerKey && creds.consumerSecret);
}

async function wooRestRequest(endpoint, { method = 'GET', body } = {}, storeHint = '') {
  const storeDefinition = resolveStoreDefinition(storeHint);
  const creds = getWooCredentialsForStore(storeDefinition.baseUrl);
  const url = new URL(`${storeDefinition.restApiBase}${endpoint}`);
  if (creds.consumerKey && creds.consumerSecret) {
    url.searchParams.set('consumer_key', creds.consumerKey);
    url.searchParams.set('consumer_secret', creds.consumerSecret);
  }

  const response = await fetch(url, {
    method,
    headers: {
      ...(creds.consumerKey && creds.consumerSecret
        ? {
            Authorization: `Basic ${Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString('base64')}`
          }
        : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    dispatcher: insecureDispatcher
  });

  const rawText = await response.text();
  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    throw new Error(`Woo REST API ${method} ${endpoint} fallo con HTTP ${response.status}: ${rawText}`);
  }

  return { json, rawText };
}

async function searchProductByName({ storeHint = '', productName = '' }) {
  const query = String(productName || '').trim();
  if (!query) return null;

  const response = await wooRestRequest(
    `/products?search=${encodeURIComponent(query)}&per_page=10&status=publish`,
    { method: 'GET' },
    storeHint
  );

  const products = Array.isArray(response.json) ? response.json : [];
  if (!products.length) return null;

  const normalizedQuery = normalizeStoreHint(query);
  const exactMatch = products.find((product) => {
    const productNameValue = normalizeStoreHint(product?.name || product?.title || '');
    return productNameValue === normalizedQuery || productNameValue.includes(normalizedQuery);
  });

  return exactMatch || products[0] || null;
}

function extractProductAmount(product = {}) {
  const candidates = [
    product?.price,
    product?.regular_price,
    product?.sale_price,
    product?.prices?.price,
    product?.prices?.regular_price,
    product?.prices?.sale_price
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate ?? '').trim();
    if (!normalized) continue;
    const digits = normalized.replace(/[^\d]/g, '');
    if (digits) return digits;
  }

  return '';
}

function extractProductImageUrl(product = {}) {
  const images = Array.isArray(product?.images) ? product.images : [];
  const image = images.find((item) => String(item?.src || item?.url || '').trim()) || images[0] || null;
  return String(image?.src || image?.url || image?.thumbnail || '').trim();
}

async function getProductById({ storeHint = '', productId = '' }) {
  const resolvedId = String(productId || '').trim();
  if (!resolvedId) return null;

  const response = await wooRestRequest(
    `/products/${encodeURIComponent(resolvedId)}`,
    { method: 'GET' },
    storeHint
  );

  return response.json || null;
}

async function updateOrderStatus({ orderId, status, storeHint = '' }) {
  if (!orderId || !status) {
    throw new Error('orderId y status son obligatorios para actualizar la orden.');
  }

  const { json } = await wooRestRequest(`/orders/${encodeURIComponent(orderId)}`, {
    method: 'PUT',
    body: {
      status
    }
  }, storeHint);

  return json;
}

function isInvalidNonceError(error) {
  return String(error?.message || '').includes('woocommerce_rest_invalid_nonce');
}

async function createDraftOrder({ productId, quantity, customer, orderMeta = {}, storeHint = '' }) {
  const storeDefinition = resolveStoreDefinition(storeHint);

  if (hasWooCredentialsForStore(storeDefinition.baseUrl)) {
    const creds = getWooCredentialsForStore(storeDefinition.baseUrl);
    const payload = {
      status: 'pending',
      customer_id: 0,
      billing: customer.billingAddress,
      shipping: customer.shippingAddress,
      line_items: [
        {
          product_id: Number(productId),
          quantity: Number(quantity || 1),
          subtotal: orderMeta.subtotal || undefined,
          total: orderMeta.total || undefined
        }
      ]
    };

    const { json } = await wooRestRequest('/orders', {
      method: 'POST',
      body: payload
    }, storeHint);

    return {
      orderId: String(json?.id || ''),
      orderKey: String(json?.order_key || ''),
      rawOrder: json
    };
  }

  const addItemPayload = {
    id: Number(productId),
    quantity: Number(quantity || 1)
  };

  const addItemWithFreshCart = async () => {
    const cart = await wooRequest('/cart', {}, storeHint);
    const nonce = cart.headers.nonce;
    const cartToken = cart.headers.cartToken;
    if (!nonce || !cartToken) {
      throw new Error('No fue posible obtener nonce o cart token del carrito.');
    }

    return wooRequest('/cart/add-item', {
      method: 'POST',
      nonce,
      cartToken,
      body: addItemPayload
    }, storeHint);
  };

  let addItem;
  try {
    addItem = await addItemWithFreshCart();
  } catch (error) {
    if (!isInvalidNonceError(error)) {
      throw error;
    }

    console.warn(`${LOG_PREFIX} invalid nonce on add-item, retrying with fresh cart`);
    addItem = await addItemWithFreshCart();
  }

  let nonce = addItem.headers.nonce;
  const cartToken = addItem.headers.cartToken;

  const updateCustomer = await wooRequest('/cart/update-customer', {
    method: 'POST',
    nonce,
    cartToken,
    body: {
      billing_address: customer.billingAddress,
      shipping_address: customer.shippingAddress
    }
  }, storeHint);
  nonce = updateCustomer.headers.nonce || nonce;

  const checkout = await wooRequest('/checkout', {
    method: 'GET',
    nonce,
    cartToken
  }, storeHint);

  return {
    orderId: String(checkout.json?.order_id || ''),
    orderKey: String(checkout.json?.order_key || ''),
    cartToken,
    nonce
  };
}

function buildAddressPayload(userData, cedula) {
  const deliveryData = userData?.deliveryData || {};
  const name = stringValue(userData?.name, 'Cliente BBVA');
  const [firstName, ...rest] = name.split(/\s+/);
  const lastName = rest.join(' ') || 'BBVA';
  const email = stringValue(deliveryData.email || userData?.email, `compras+${cedula}@bbva.demo`);
  const phone = stringValue(deliveryData.phone, '3000000000');
  const address1 = stringValue(deliveryData.address);
  const city = stringValue(deliveryData.city);
  const state = buildStateCode(deliveryData);
  const postcode = buildPostcode(deliveryData);

  if (!address1 || !city) {
    throw new Error('El usuario no tiene direccion de entrega configurada en la app BBVA.');
  }

  return {
    shippingAddress: {
      first_name: firstName,
      last_name: lastName,
      company: '',
      address_1: address1,
      address_2: '',
      city,
      state,
      postcode,
      country: 'CO',
      phone
    },
    billingAddress: {
      first_name: firstName,
      last_name: lastName,
      company: '',
      address_1: address1,
      address_2: '',
      city,
      state,
      postcode,
      country: 'CO',
      email,
      phone
    },
    recipient: name,
    email,
    phone,
    address: address1,
    city,
    department: stringValue(deliveryData.department)
  };
}

async function sendPaymentPush({
  userData,
  cedula,
  sessionId,
  orderId,
  orderKey,
  productId,
  storeId,
  productName,
  amount,
  imageUrl,
  shipping
}) {
  if (!userData?.fcmToken) {
    throw new Error('El usuario no tiene un token FCM registrado.');
  }

  const message = {
    token: userData.fcmToken,
    notification: {
      title: 'Confirma tu compra',
      body: `Tu producto sera enviado a ${shipping.address}, ${shipping.city}. Revisa y confirma el pago en tu app BBVA.`
    },
    data: {
      type: 'ORDER_PAYMENT_REQUEST',
      orderId: String(orderId),
      orderKey: String(orderKey),
      productId: String(productId),
      storeId: String(storeId),
      productName: stringValue(productName),
      amount: stringValue(amount),
      cedula: String(cedula),
      sessionId: sanitizeSessionId(sessionId),
      imageUrl: stringValue(imageUrl, notificationIcon),
      shippingRecipient: shipping.recipient,
      shippingAddress: shipping.address,
      shippingCity: shipping.city,
      shippingDepartment: shipping.department,
      shippingEmail: shipping.email,
      shippingPhone: shipping.phone
    },
    android: {
      priority: 'high'
    },
    apns: {
      payload: {
        aps: {
          'content-available': 1
        }
      }
    }
  };

  return admin.messaging().send(message);
}

async function sendAuthPush({
  userData,
  cedula,
  sessionId,
  userName
}) {
  if (!userData?.fcmToken) {
    throw new Error('El usuario no tiene un token FCM registrado.');
  }

  const message = {
    token: userData.fcmToken,
    notification: {
      title: 'Verificación de identidad',
      body: 'Se ha solicitado acceso a tu cuenta BBVA'
    },
    data: {
      type: 'AUTH_REQUEST',
      cedula: String(cedula),
      sessionId: sanitizeSessionId(sessionId),
      userName: stringValue(userName || userData?.name || ''),
      imageUrl: ''
    },
    android: {
      priority: 'high'
    },
    apns: {
      payload: {
        aps: {
          'content-available': 1
        }
      }
    }
  };

  return admin.messaging().send(message);
}

async function sendDebugPush({ userData, cedula, title, body, data = {} }) {
  if (!userData?.fcmToken) {
    throw new Error('El usuario no tiene un token FCM registrado.');
  }

  const message = {
    token: userData.fcmToken,
    notification: {
      title: title || 'Prueba manual desde GCP',
      body: body || 'Si ves esto, la push llegó desde el bridge.'
    },
    data: {
      type: String(data.type || 'TEST_PUSH'),
      source: String(data.source || 'voice-commerce-bridge'),
      cedula: String(cedula || ''),
      ...Object.fromEntries(
        Object.entries(data || {}).map(([key, value]) => [key, String(value ?? '')])
      )
    },
    android: {
      priority: 'high'
    },
    apns: {
      payload: {
        aps: {
          'content-available': 1
        }
      }
    }
  };

  console.log(`${LOG_PREFIX} debug push message`, {
    cedula,
    tokenPresent: Boolean(userData?.fcmToken),
    data: message.data
  });

  return admin.messaging().send(message);
}

function getExistingPurchaseSession(sessionId) {
  const safeSessionId = sanitizeSessionId(sessionId);
  if (!safeSessionId) return null;

  const existing = sessionReplies.get(safeSessionId);
  if (!existing || !existing.orderId) return null;

  return existing;
}

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Nonce, Cart-Token');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    wooBaseUrl,
    firebaseProjectId
  });
});

app.get('/lookup-user', async (req, res) => {
  const cedula = String(req.query?.cedula || '').trim();
  const normalizedCedula = cedula.replace(/\D/g, '');

  console.log(`${LOG_PREFIX} lookup-user received`, {
    cedula,
    normalizedCedula
  });

  if (!normalizedCedula) {
    res.status(400).json({
      ok: false,
      error: 'cedula es obligatoria.'
    });
    return;
  }

  try {
    const userData = await readUser(normalizedCedula);
    console.log(`${LOG_PREFIX} lookup-user firestore result`, {
      cedula: normalizedCedula,
      found: Boolean(userData),
      hasAccountId: Boolean(userData?.accountId),
      hasCreditCardId: Boolean(userData?.creditCardId),
      hasDeliveryData: Boolean(userData?.deliveryData)
    });

    if (!userData) {
      res.json({
        ok: true,
        found: false,
        cedula: normalizedCedula,
        user: null
      });
      return;
    }

    res.json({
      ok: true,
      found: true,
      cedula: normalizedCedula,
      user: {
        name: userData.name || '',
        cedula: normalizedCedula,
        email: userData.email || '',
        accountId: userData.accountId || '',
        creditCardId: userData.creditCardId || '',
        pagosInteligentes: isPagosInteligentesEnabled(userData),
        piSettings: userData.piSettings || null,
        deliveryData: userData.deliveryData || null,
        fcmToken: userData.fcmToken || ''
      }
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} lookup-user error`, error);
    res.status(500).json({
      ok: false,
      error: error?.message || 'No pude consultar el usuario.'
    });
  }
});

app.post('/request-purchase', async (req, res) => {
  const {
    cedula,
    sessionId,
    productId,
    productName = '',
    storeId,
    storeName = '',
    amount = '',
    imageUrl = '',
    quantity = 1
  } = req.body || {};

  console.log(`${LOG_PREFIX} request-purchase received`, {
    cedula,
    sessionId,
    productId,
    storeId,
    storeName,
    productName,
    amount,
    quantity
  });

  if (!cedula || !sessionId) {
    res.status(400).json({
      resultado: 'Faltan datos obligatorios para preparar la compra.'
    });
    return;
  }

  try {
    const safeSessionId = sanitizeSessionId(sessionId);
    if (!safeSessionId) {
      res.status(400).json({
        resultado: 'sessionId invalido para preparar la compra.'
      });
      return;
    }

    const lockedPurchase = purchaseLocks.get(safeSessionId);
    if (lockedPurchase) {
      console.log(`${LOG_PREFIX} request-purchase deduplicated`, {
        cedula,
        sessionId: safeSessionId,
        orderId: lockedPurchase.orderId || '',
        state: lockedPurchase.state
      });
      if (lockedPurchase.promise) {
        const existing = await lockedPurchase.promise;
        res.json(existing);
        return;
      }
    }

    let resolvePurchaseLock;
    const lockPromise = new Promise((resolve, reject) => {
      resolvePurchaseLock = resolve;
    });
    purchaseLocks.set(safeSessionId, {
      state: 'in_progress',
      promise: lockPromise
    });

    const userData = await readUser(cedula);
    console.log(`${LOG_PREFIX} firestore lookup result`, {
      cedula,
      found: Boolean(userData),
      hasAccountId: Boolean(userData?.accountId),
      hasCreditCardId: Boolean(userData?.creditCardId),
      hasDeliveryData: Boolean(userData?.deliveryData)
    });
    if (!userData) {
      res.status(200).json({
        resultado: 'No encontré una cuenta asociada a esa cédula.'
      });
      return;
    }

    const storeHint = String(storeId || storeName || '').trim();
    let resolvedProductId = String(productId || '').trim();
    let resolvedStoreId = String(storeId || '').trim();

    if ((!resolvedProductId || !resolvedStoreId) && productName) {
      const matchedProduct = await searchProductByName({
        storeHint,
        productName
      });

      if (matchedProduct) {
        resolvedProductId = resolvedProductId || String(matchedProduct.id || matchedProduct.product_id || '').trim();
        console.log(`${LOG_PREFIX} request-purchase product resolved`, {
          cedula,
          productName,
          resolvedProductId,
          storeHint,
          matchedTitle: matchedProduct.name || matchedProduct.title || ''
        });
      }
    }

    if (!resolvedProductId) {
      throw new Error('No pude resolver el producto a partir del nombre recibido.');
    }

    if (!resolvedStoreId) {
      resolvedStoreId = resolveStoreDefinition(storeHint).storeId;
    }

    let resolvedProduct = null;
    try {
      resolvedProduct = await getProductById({
        storeHint,
        productId: resolvedProductId
      });
    } catch (error) {
      console.warn(`${LOG_PREFIX} request-purchase product details lookup failed`, {
        cedula,
        productId: resolvedProductId,
        message: error?.message || String(error)
      });
    }

    const resolvedAmount = extractProductAmount(resolvedProduct) || parsePriceToString(amount);
    const resolvedImageUrl = extractProductImageUrl(resolvedProduct) || stringValue(imageUrl, notificationIcon);

    const shipping = buildAddressPayload(userData, cedula);
    const paymentRequestedText = 'He enviado una solicitud de pago a tu App BBVA. Revisa la confirmacion y apruebala para finalizar tu pedido.';
    const purchaseFingerprint = buildPurchaseFingerprint({
      cedula,
      productId: resolvedProductId,
      storeId: resolvedStoreId,
      amount: resolvedAmount,
      shipping
    });

    const existingFingerprintPurchase = purchaseFingerprintIndex.get(purchaseFingerprint);
    if (existingFingerprintPurchase?.orderId && (existingFingerprintPurchase.status === 'PAYMENT_REQUESTED' || existingFingerprintPurchase.status === 'APROBADO')) {
      console.log(`${LOG_PREFIX} request-purchase deduplicated by fingerprint`, {
        cedula,
        sessionId: safeSessionId,
        fingerprint: purchaseFingerprint,
        orderId: existingFingerprintPurchase.orderId,
        status: existingFingerprintPurchase.status
      });

      const responsePayload = {
        resultado: existingFingerprintPurchase.text || paymentRequestedText,
        orderId: String(existingFingerprintPurchase.orderId),
        orderKey: String(existingFingerprintPurchase.orderKey || ''),
        productId: String(existingFingerprintPurchase.productId || resolvedProductId),
        storeId: String(existingFingerprintPurchase.storeId || resolvedStoreId),
        amount: String(existingFingerprintPurchase.amount || resolvedAmount),
        imageUrl: String(existingFingerprintPurchase.imageUrl || resolvedImageUrl || notificationIcon),
        shippingAddress: existingFingerprintPurchase.shippingAddress || shipping.address,
        shippingCity: existingFingerprintPurchase.shippingCity || shipping.city,
        shippingRecipient: existingFingerprintPurchase.shippingRecipient || shipping.recipient
      };
      sessionReplies.set(safeSessionId, {
        text: responsePayload.resultado,
        status: 'PAYMENT_REQUESTED',
        cedula,
        userName: userData.name || '',
        orderId: String(existingFingerprintPurchase.orderId),
        orderKey: String(existingFingerprintPurchase.orderKey || ''),
        productId: String(existingFingerprintPurchase.productId || resolvedProductId),
        storeId: String(existingFingerprintPurchase.storeId || resolvedStoreId),
        productName: stringValue(productName),
        amount: String(existingFingerprintPurchase.amount || resolvedAmount),
        imageUrl: String(existingFingerprintPurchase.imageUrl || resolvedImageUrl || notificationIcon),
        shippingRecipient: existingFingerprintPurchase.shippingRecipient || shipping.recipient,
        shippingAddress: existingFingerprintPurchase.shippingAddress || shipping.address,
        shippingCity: existingFingerprintPurchase.shippingCity || shipping.city,
        shippingDepartment: shipping.department,
        shippingEmail: shipping.email,
        shippingPhone: shipping.phone,
        updatedAt: new Date().toISOString()
      });
      purchaseFingerprintIndex.set(purchaseFingerprint, {
        ...existingFingerprintPurchase,
        status: 'PAYMENT_REQUESTED',
        updatedAt: new Date().toISOString()
      });
      purchaseLocks.delete(safeSessionId);
      resolvePurchaseLock?.(responsePayload);
      res.json(responsePayload);
      return;
    }

    const existingPurchase = getExistingPurchaseSession(sessionId);
    if (existingPurchase?.status === 'PAYMENT_REQUESTED' || existingPurchase?.status === 'APROBADO') {
      console.log(`${LOG_PREFIX} request-purchase reused existing order`, {
        cedula,
        sessionId,
        orderId: existingPurchase.orderId,
        status: existingPurchase.status
      });

      res.json({
        resultado: existingPurchase.text || paymentRequestedText,
        orderId: String(existingPurchase.orderId),
        orderKey: String(existingPurchase.orderKey || ''),
        productId: String(existingPurchase.productId || resolvedProductId),
        storeId: String(existingPurchase.storeId || resolvedStoreId),
        amount: String(existingPurchase.amount || resolvedAmount),
        imageUrl: String(existingPurchase.imageUrl || resolvedImageUrl || notificationIcon),
        shippingAddress: existingPurchase.shippingAddress || shipping.address,
        shippingCity: existingPurchase.shippingCity || shipping.city,
        shippingRecipient: existingPurchase.shippingRecipient || shipping.recipient
      });
      purchaseLocks.delete(safeSessionId);
      resolvePurchaseLock({
        resultado: existingPurchase.text || paymentRequestedText,
        orderId: String(existingPurchase.orderId),
        orderKey: String(existingPurchase.orderKey || ''),
        productId: String(existingPurchase.productId || resolvedProductId),
        storeId: String(existingPurchase.storeId || resolvedStoreId),
        amount: String(existingPurchase.amount || resolvedAmount),
        imageUrl: String(existingPurchase.imageUrl || resolvedImageUrl || notificationIcon),
        shippingAddress: existingPurchase.shippingAddress || shipping.address,
        shippingCity: existingPurchase.shippingCity || shipping.city,
        shippingRecipient: existingPurchase.shippingRecipient || shipping.recipient
      });
      return;
    }

    const draftOrder = await createDraftOrder({
      productId: resolvedProductId,
      quantity,
      customer: shipping,
      orderMeta: {
        subtotal: resolvedAmount,
        total: resolvedAmount
      },
      storeHint
    });

    await sendPaymentPush({
      userData,
      cedula,
      sessionId,
      orderId: draftOrder.orderId,
      orderKey: draftOrder.orderKey,
      productId: resolvedProductId,
      storeId: resolvedStoreId,
      productName,
      amount: resolvedAmount,
      imageUrl: resolvedImageUrl,
      shipping
    });

    sessionReplies.set(safeSessionId, {
      text: paymentRequestedText,
      status: 'PAYMENT_REQUESTED',
      cedula,
      userName: userData.name || '',
      orderId: String(draftOrder.orderId),
      orderKey: String(draftOrder.orderKey),
      productId: String(resolvedProductId),
      storeId: String(resolvedStoreId),
      productName: stringValue(productName),
      amount: resolvedAmount,
      imageUrl: resolvedImageUrl,
      shippingRecipient: shipping.recipient,
      shippingAddress: shipping.address,
      shippingCity: shipping.city,
      shippingDepartment: shipping.department,
      shippingEmail: shipping.email,
      shippingPhone: shipping.phone,
      updatedAt: new Date().toISOString()
    });
    purchaseFingerprintIndex.set(purchaseFingerprint, {
      status: 'PAYMENT_REQUESTED',
      orderId: String(draftOrder.orderId),
      orderKey: String(draftOrder.orderKey),
      productId: String(resolvedProductId),
      storeId: String(resolvedStoreId),
      amount: resolvedAmount,
      imageUrl: resolvedImageUrl,
      shippingRecipient: shipping.recipient,
      shippingAddress: shipping.address,
      shippingCity: shipping.city,
      shippingDepartment: shipping.department,
      shippingEmail: shipping.email,
      shippingPhone: shipping.phone,
      text: paymentRequestedText,
      updatedAt: new Date().toISOString()
    });

    console.log(`${LOG_PREFIX} purchase prepared`, {
      cedula,
      sessionId,
      productId,
      storeId,
      orderId: draftOrder.orderId
    });

    res.json({
      resultado: paymentRequestedText,
      orderId: draftOrder.orderId,
      orderKey: draftOrder.orderKey,
      productId: String(resolvedProductId),
      storeId: String(resolvedStoreId),
      amount: resolvedAmount,
      imageUrl: resolvedImageUrl,
      shippingAddress: shipping.address,
      shippingCity: shipping.city,
      shippingRecipient: shipping.recipient
    });
    resolvePurchaseLock({
      resultado: paymentRequestedText,
      orderId: draftOrder.orderId,
      orderKey: draftOrder.orderKey,
      productId: String(resolvedProductId),
      storeId: String(resolvedStoreId),
      amount: resolvedAmount,
      imageUrl: resolvedImageUrl,
      shippingAddress: shipping.address,
      shippingCity: shipping.city,
      shippingRecipient: shipping.recipient
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} request-purchase error`, error);
    if (resolvePurchaseLock) {
      resolvePurchaseLock({
        resultado: error?.message || 'No pude preparar la compra en este momento.'
      });
    }
    purchaseLocks.delete(sanitizeSessionId(sessionId));
    res.status(500).json({
      resultado: error?.message || 'No pude preparar la compra en este momento.'
    });
  }
});

app.post('/request-auth', async (req, res) => {
  const {
    cedula,
    sessionId,
    userName = ''
  } = req.body || {};

  const normalizedCedula = String(cedula || '').replace(/\D/g, '');

  console.log(`${LOG_PREFIX} request-auth received`, {
    cedula: normalizedCedula,
    sessionId,
    userName
  });

  if (!normalizedCedula || !sessionId) {
    res.status(400).json({
      resultado: 'cedula y sessionId son obligatorios.'
    });
    return;
  }

  try {
    const userData = await readUser(normalizedCedula);
    console.log(`${LOG_PREFIX} request-auth firestore lookup`, {
      cedula: normalizedCedula,
      found: Boolean(userData),
      hasFcmToken: Boolean(userData?.fcmToken),
      pagosInteligentes: isPagosInteligentesEnabled(userData)
    });

    if (!userData) {
      res.status(404).json({
        resultado: 'No encontré una cuenta asociada a esa cédula.'
      });
      return;
    }

    if (!isPagosInteligentesEnabled(userData)) {
      res.status(200).json(buildPiDisabledResponse(userData, normalizedCedula));
      return;
    }

    await sendAuthPush({
      userData,
      cedula: normalizedCedula,
      sessionId,
      userName: userName || userData?.name || ''
    });

    res.json({
      ok: true,
      resultado: 'Push de autenticación enviada correctamente desde GCP.',
      cedula: normalizedCedula
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} request-auth error`, error);
    res.status(500).json({
      ok: false,
      resultado: error?.message || 'No pude enviar la push de autenticación.'
    });
  }
});

app.post('/debug-test-push', async (req, res) => {
  const {
    cedula,
    title = 'Prueba manual desde GCP',
    body = 'Si ves esto, la push llegó desde el bridge.',
    data = {}
  } = req.body || {};

  const normalizedCedula = String(cedula || '').replace(/\D/g, '');
  if (!normalizedCedula) {
    res.status(400).json({ resultado: 'cedula es obligatoria.' });
    return;
  }

  try {
    const userData = await readUser(normalizedCedula);
    console.log(`${LOG_PREFIX} debug-test-push received`, {
      cedula: normalizedCedula,
      found: Boolean(userData),
      hasFcmToken: Boolean(userData?.fcmToken)
    });

    if (!userData) {
      res.status(404).json({ resultado: 'No encontré una cuenta asociada a esa cédula.' });
      return;
    }

    const messageId = await sendDebugPush({
      userData,
      cedula: normalizedCedula,
      title,
      body,
      data
    });

    res.json({
      ok: true,
      resultado: 'Push de prueba enviada correctamente desde GCP.',
      cedula: normalizedCedula,
      messageId
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} debug-test-push error`, error);
    res.status(500).json({
      ok: false,
      resultado: error?.message || 'No pude enviar la push de prueba.'
    });
  }
});

app.post('/payment-approved', async (req, res) => {
  const {
    orderId,
    sessionId = '',
    status = 'processing',
    storeId = '',
    storeName = '',
    productName = '',
    shippingAddress = '',
    shippingCity = ''
  } = req.body || {};

  if (!orderId) {
    res.status(400).json({
      resultado: 'orderId es obligatorio para actualizar el estado del pedido.'
    });
    return;
  }

  try {
    const updatedOrder = await updateOrderStatus({
      orderId,
      status: String(status).toLowerCase(),
      storeHint: storeId || storeName
    });

    console.log(`${LOG_PREFIX} payment approved`, {
      orderId,
      sessionId,
      status
    });

    const normalizedSessionId = sanitizeSessionId(sessionId);
    if (normalizedSessionId) {
      const replyText = 'Pago aprobado. La compra quedó confirmada y seguirá el proceso.';
      sessionReplies.set(normalizedSessionId, {
        text: replyText,
        status: 'APROBADO',
        orderId: String(orderId),
        productName: stringValue(productName),
        shippingAddress: stringValue(shippingAddress),
        shippingCity: stringValue(shippingCity),
        updatedAt: new Date().toISOString()
      });
    }

    res.json({
      ok: true,
      resultado: 'Pedido actualizado a processing correctamente.',
      orderId: String(orderId),
      status: String(status).toLowerCase(),
      updatedOrder
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} payment-approved error`, error);
    res.status(500).json({
      resultado: error?.message || 'No pude actualizar el estado del pedido.'
    });
  }
});

app.get('/purchase-result/:sessionId', (req, res) => {
  const sessionId = sanitizeSessionId(req.params.sessionId);
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId invalido.' });
    return;
  }

  const item = sessionReplies.get(sessionId);
  const isPurchaseState = Boolean(
    item?.status === 'PAYMENT_REQUESTED'
    || item?.status === 'APROBADO'
    || item?.orderId
    || item?.productId
  );

  let result = null;
  if (isPurchaseState) {
    result = item;
    if (item?.status === 'APROBADO') {
      result = {
        ...item,
        text: item.text || 'Pago aprobado. La compra quedó confirmada y seguirá el proceso.'
      };
    }
  }

  res.json({
    ok: true,
    found: Boolean(item),
    sessionId,
    result
  });
});

app.listen(port, () => {
  console.log(`${LOG_PREFIX} listening`, {
    port,
    wooBaseUrl,
    firebaseProjectId
  });
});
