/**
 * ============================================================================
 * ROO RETARGETING AI — roo | Soluciones Digitales (FASE LEAD -> PAYER)
 * Motor Autónomo Omnicanal Universal con Aprendizaje Cerrado A/B, XAI y NLU
 * - Persistencia 100% local atómica (CERO creación/alteración de tablas SQL)
 * - DML opcional sobre BD externa solo para transición real LEAD -> PAYER
 * - Scoring + Trazabilidad Explicable (XAI) + Fallback Cross-Channel + Quiet Hours
 * - Máquina de Estados Multi-Toque (Toque 1 -> Tracking Apertura/Clic -> Toque 2 Cupón)
 * - WhatsApp Real Bidireccional (@whiskeysockets/baileys) con resolución @lid y Guardrails
 * - Correo Real Gmail SMTP (465/587) + Píxel de apertura + Visor HTML local
 * - SDK Web Universal (/sdk/roo-agent.js) + Sandbox (/demo-shop.html)
 * ============================================================================
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sql = require('mssql');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

// ----------------------------------------------------------------------------
// 0. CARGA DE VARIABLES DE ENTORNO (.env) SIN DEPENDENCIAS EXTERNAS
// ----------------------------------------------------------------------------
(function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
})();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const PUBLIC_AGENT_URL = (process.env.AGENT_PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: 'text/plain', limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// PNG 1x1 transparente para tracking de apertura de correos
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

// ----------------------------------------------------------------------------
// 1. CATÁLOGO OFICIAL SINCRONIZABLE (FALLBACK LOCAL + SYNC HTTP OPCIONAL)
// ----------------------------------------------------------------------------
const CATEGORY_IMAGE_MAP = {
  iPhone: 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?auto=format&fit=crop&w=900&q=85',
  MacBook: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=85',
  Mac: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=85',
  iPad: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&w=900&q=85',
  'Apple Watch': 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?auto=format&fit=crop&w=900&q=85',
  Watch: 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?auto=format&fit=crop&w=900&q=85',
  AirPods: 'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?auto=format&fit=crop&w=900&q=85',
  Accesorios: 'https://images.unsplash.com/photo-1615526675159-e248c3021d3f?auto=format&fit=crop&w=900&q=85',
};

const STOREFRONT_PUBLIC_DIR = process.env.STOREFRONT_MEDIA_DIR
  ? path.resolve(process.env.STOREFRONT_MEDIA_DIR)
  : path.join(__dirname, 'public', 'assets');
if (fs.existsSync(STOREFRONT_PUBLIC_DIR)) {
  app.use('/catalog-media', express.static(STOREFRONT_PUBLIC_DIR));
}
const CATEGORY_LOCAL_MEDIA = {
  iPhone: 'products/iphone-18-pro.png',
  MacBook: 'products/macbook-air.png',
  Mac: 'products/macbook-air.png',
  iPad: 'products/ipad-pro.jpg',
  AirPods: 'products/airpods-pro.png',
};

let CATALOG = [
  {
    id: 1,
    slug: 'iphone-18-pro-max',
    sku: 'APL-IP18PM-256-BG',
    name: 'iPhone 18 Pro Max 256 GB',
    shortName: 'iPhone 18 Pro Max',
    category: 'iPhone',
    condition: 'NUEVO_SELLADO',
    color: 'Burgundy',
    capacity: '256 GB',
    stock: 5,
    price: 7199.0,
    originalPrice: 7899.0,
    installment3: 2399.67,
    specs: 'Chip A20 Pro 2nm, Super Retina XDR 6.9" 120Hz, sellado Apple USA.',
    image: CATEGORY_IMAGE_MAP.iPhone,
  },
  {
    id: 2,
    slug: 'iphone-17-pro-max',
    sku: 'APL-IP17PM-256-TN',
    name: 'iPhone 17 Pro Max 256 GB',
    shortName: 'iPhone 17 Pro Max',
    category: 'iPhone',
    condition: 'NUEVO_SELLADO',
    color: 'Titanio Natural',
    capacity: '256 GB',
    stock: 6,
    price: 6199.0,
    originalPrice: 6899.0,
    installment3: 2066.33,
    specs: 'Chip A19 Pro (3nm), Super Retina XDR 6.9" 120Hz, sellado Apple USA.',
    image: CATEGORY_IMAGE_MAP.iPhone,
  },
  {
    id: 3,
    slug: 'iphone-16-pro-max',
    sku: 'APL-IP16PM-256-TN',
    name: 'iPhone 16 Pro Max 256 GB',
    shortName: 'iPhone 16 Pro Max',
    category: 'iPhone',
    condition: 'NUEVO_SELLADO',
    color: 'Titanio Natural',
    capacity: '256 GB',
    stock: 9,
    price: 5599.0,
    originalPrice: 6199.0,
    installment3: 1866.33,
    specs: 'Pantalla 6.9" Super Retina XDR, Chip A18 Pro, Cámara 48MP 5x.',
    image: CATEGORY_IMAGE_MAP.iPhone,
  },
  {
    id: 12,
    slug: 'macbook-air-m4-13',
    sku: 'APL-MBA-M4-13',
    name: 'MacBook Air 13" Chip M4 16GB / 512GB',
    shortName: 'MacBook Air M4',
    category: 'MacBook',
    condition: 'NUEVO_SELLADO',
    color: 'Medianoche',
    capacity: '16 GB / 512 GB SSD',
    stock: 5,
    price: 5499.0,
    originalPrice: 6199.0,
    installment3: 1833.0,
    specs: 'Liquid Retina 13.6", Chip Apple M4, 16 GB RAM unificada, 18h batería.',
    image: CATEGORY_IMAGE_MAP.MacBook,
  },
  {
    id: 17,
    slug: 'ipad-air-m3',
    sku: 'APL-IPADAIR-M3',
    name: 'iPad Air 11" Chip M3 128 GB',
    shortName: 'iPad Air M3',
    category: 'iPad',
    condition: 'NUEVO_SELLADO',
    color: 'Gris Espacial',
    capacity: '128 GB Wi-Fi',
    stock: 5,
    price: 3199.0,
    originalPrice: 3599.0,
    installment3: 1066.33,
    specs: 'Liquid Retina 11", Chip M3, compatible Apple Pencil Pro.',
    image: CATEGORY_IMAGE_MAP.iPad,
  },
  {
    id: 21,
    slug: 'airpods-pro-2',
    sku: 'APL-APP2-USBC',
    name: 'AirPods Pro 2 (USB-C)',
    shortName: 'AirPods Pro 2',
    category: 'AirPods',
    condition: 'NUEVO_SELLADO',
    color: 'Blanco',
    capacity: 'USB-C MagSafe',
    stock: 11,
    price: 1099.0,
    originalPrice: 1299.0,
    installment3: 366.33,
    specs: 'Chip H2, Cancelación activa 2x, estuche MagSafe.',
    image: CATEGORY_IMAGE_MAP.AirPods,
  },
];

function resolveProductMedia(imageUrl, category) {
  const rel = String(imageUrl || '').trim();
  if (rel.startsWith('/')) {
    const cleanRel = rel.replace(/^\/+/, '');
    const candidate = path.join(STOREFRONT_PUBLIC_DIR, cleanRel);
    const ext = path.extname(cleanRel).toLowerCase();
    if ((ext === '.png' || ext === '.jpg' || ext === '.jpeg') && fs.existsSync(candidate)) {
      return {
        image: `${PUBLIC_AGENT_URL}/catalog-media/${cleanRel}`,
        localMediaPath: candidate,
        emailImageUrl: CATEGORY_IMAGE_MAP[category] || CATEGORY_IMAGE_MAP.iPhone,
      };
    }
  }
  const catRel = CATEGORY_LOCAL_MEDIA[category];
  if (catRel) {
    const catPath = path.join(STOREFRONT_PUBLIC_DIR, catRel);
    if (fs.existsSync(catPath)) {
      return {
        image: rel.startsWith('http') ? rel : `${PUBLIC_AGENT_URL}/catalog-media/${catRel}`,
        localMediaPath: catPath,
        emailImageUrl: rel.startsWith('http') ? rel : CATEGORY_IMAGE_MAP[category] || CATEGORY_IMAGE_MAP.iPhone,
      };
    }
  }
  const fallbackUrl = rel.startsWith('http') ? rel : CATEGORY_IMAGE_MAP[category] || CATEGORY_IMAGE_MAP.iPhone;
  return { image: fallbackUrl, localMediaPath: null, emailImageUrl: fallbackUrl };
}

// Enriquecer medios del catálogo fallback
CATALOG = CATALOG.map((item) => {
  const media = resolveProductMedia('', item.category);
  return { ...item, ...media, image: item.image || media.image };
});

async function syncCatalogFromStorefront() {
  const url = process.env.STOREFRONT_CATALOG_URL || 'http://localhost:3000/proyectobi/storefront/catalog';
  try {
    const resp = await fetch(url);
    if (!resp.ok) return;
    const remote = await resp.json();
    if (!Array.isArray(remote) || !remote.length) return;
    CATALOG = remote.map((item, idx) => {
      const price = Number(item.pricePen || 4299);
      const media = resolveProductMedia(item.imageUrl, item.category);
      return {
        id: Number(item.dbProductId || idx + 1),
        slug: item.slug,
        sku: item.sku || `ROO-${idx + 1}`,
        name: item.name,
        shortName: item.shortName || item.name,
        category: item.category || 'iPhone',
        condition: item.condition || 'NUEVO_SELLADO',
        color: item.color || 'Oficial',
        capacity: item.capacity || '256 GB',
        stock: Number(item.stock ?? 5),
        price,
        originalPrice: Number(item.originalPricePen || Math.round(price * 1.12)),
        installment3: Number((price / 3).toFixed(2)),
        specs: item.tagline || `${item.specs?.chip || 'Apple Silicon'} · ${item.specs?.display || ''}`.trim(),
        image: media.image,
        localMediaPath: media.localMediaPath,
        emailImageUrl: media.emailImageUrl,
      };
    });
    console.log(`🔄 Catálogo sincronizado (${CATALOG.length} productos).`);
  } catch {
    // Opera con catálogo local autónomo si Storefront no está corriendo
  }
}

function findProduct(idOrSlugOrName) {
  const activeCat = Array.isArray(appState?.customProducts) && appState.customProducts.length
    ? [...CATALOG, ...appState.customProducts]
    : CATALOG;
  if (!idOrSlugOrName) return activeCat[0];
  const s = String(idOrSlugOrName).toLowerCase();
  return (
    activeCat.find(
      (p) =>
        String(p.id) === s ||
        String(p.slug || '').toLowerCase() === s ||
        String(p.name || '').toLowerCase().includes(s) ||
        String(p.shortName || '').toLowerCase().includes(s)
    ) || activeCat[0]
  );
}

// ----------------------------------------------------------------------------
// 2. PERSISTENCIA 100% LOCAL ATÓMICA (ZERO-DDL)
// ----------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'retargeting_state.json');
const LEGACY_DATA_FILE = path.join(__dirname, 'retargeting_state.json');

const DEFAULT_CONFIG = {
  brandCompany: 'roo | Soluciones Digitales',
  brandTagline: 'Tecnología con Propósito · El futuro, simple',
  storeName: process.env.STORE_NAME || 'Tienda Demo · roo',
  storeAddress: process.env.STORE_ADDRESS || 'Av. Larco 840, Víctor Larco Herrera, Trujillo',
  currencySymbol: process.env.CURRENCY_SYMBOL || 'S/',
  storeUrl: process.env.STORE_URL || `${PUBLIC_AGENT_URL}/demo-shop.html`,
  advisorName: process.env.ADVISOR_NAME || 'Asesor Comercial Roo',
  advisorPhone: process.env.ADVISOR_PHONE || '+51 900 000 000',
  advisorEmail: process.env.ADVISOR_EMAIL || 'asesor@roo-soluciones.pe',
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: Number(process.env.SMTP_PORT || 465),
  smtpUser: process.env.SMTP_USER || '',
  emailMaxSeconds: Number(process.env.RULE_EMAIL_MAX_SECONDS || 300),
  whatsappMaxSeconds: Number(process.env.RULE_WHATSAPP_MAX_SECONDS || 600),
  abandonTimeoutSeconds: Number(process.env.SESSION_ABANDON_TIMEOUT_SECONDS || 25),
  touch2DelaySeconds: Number(process.env.TOUCH2_DELAY_SECONDS || 180),
  maxDiscountPercent: Number(process.env.MAX_DISCOUNT_PERCENT || 5),
  cooldownMinutes: Number(process.env.COOLDOWN_MINUTES || 10),
  dailyCapPerLead: Number(process.env.DAILY_CAP_PER_LEAD || 6),
  quietHoursEnabled: false,
  quietHoursStart: 22,
  quietHoursEnd: 7,
};

const DEFAULT_AB_STATS = {
  URGENCIA_STOCK: { label: 'Urgencia de Stock', sent: 0, converted: 0 },
  FACILIDAD_CUOTAS: { label: 'Facilidad 3 Cuotas 0%', sent: 0, converted: 0 },
  INCENTIVO_VIP: { label: 'Incentivo VIP + Envío', sent: 0, converted: 0 },
};

function loadSeedLeadsFromEnv() {
  try {
    if (process.env.SEED_LEADS_JSON) {
      const parsed = JSON.parse(process.env.SEED_LEADS_JSON);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (_) {}
  return [
    {
      id: 80003,
      firstName: 'Usuario',
      lastName: 'Demo Uno',
      documentNumber: '00000001',
      email: 'demo.lead1@example.com',
      phone: '+51 900 000 001',
      district: 'Trujillo',
      stage: 'LEAD',
      priority: 'ALTA',
      notes: 'Lead demostrativo de plantilla',
      updatedAt: new Date().toISOString(),
    },
    {
      id: 80004,
      firstName: 'Contacto',
      lastName: 'Demo Dos',
      documentNumber: '00000002',
      email: 'demo.lead2@example.com',
      phone: '+51 900 000 002',
      district: 'Trujillo',
      stage: 'LEAD',
      priority: 'ALTA',
      notes: 'Lead demostrativo de plantilla',
      updatedAt: new Date().toISOString(),
    },
  ];
}

const DEFAULT_LEADS = loadSeedLeadsFromEnv();

let runtimeSmtpPass = process.env.SMTP_PASS || '';
let runtimeGeminiKey = process.env.GEMINI_API_KEY || '';

function sanitizeLegacyEvent(ev) {
  if (!ev || typeof ev !== 'object') return ev;
  const cleanText = (txt) => (typeof txt === 'string' ? txt.replace(/🐾|🐶/g, '🍎') : txt);
  return {
    ...ev,
    headline: cleanText(ev.headline),
    messageBody: cleanText(ev.messageBody),
    state: ev.state || (ev.status === 'CONVERTIDO_PAYER' ? 'CONVERTIDO_PAYER' : 'TOQUE_1_ENVIADO'),
    conversation: Array.isArray(ev.conversation)
      ? ev.conversation.map((m) => ({ ...m, text: cleanText(m.text) }))
      : [],
  };
}

function loadState() {
  const sourceFile = fs.existsSync(DATA_FILE) ? DATA_FILE : fs.existsSync(LEGACY_DATA_FILE) ? LEGACY_DATA_FILE : null;
  try {
    if (sourceFile) {
      const parsed = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
      const loadedConfig = { ...(parsed.config || {}) };
      delete loadedConfig.smtpPass;
      delete loadedConfig.geminiApiKey;

      // Corrige umbrales de prueba viejos (30/60) si provenían del archivo legado
      if (sourceFile === LEGACY_DATA_FILE && Number(loadedConfig.emailMaxSeconds) === 30) {
        loadedConfig.emailMaxSeconds = 300;
        loadedConfig.whatsappMaxSeconds = 600;
      }

      const rawLeads = Array.isArray(parsed.leads) && parsed.leads.length ? parsed.leads : DEFAULT_LEADS;
      const normalizedLeads = rawLeads.slice(0, 200).map((l) => ({
        ...l,
        phone: formatDisplayPhone(l.phone),
        updatedAt: l.updatedAt || new Date().toISOString(),
      }));

      return {
        config: {
          ...DEFAULT_CONFIG,
          ...loadedConfig,
          smtpUser: loadedConfig.smtpUser || process.env.SMTP_USER || '',
        },
        leads: normalizedLeads,
        events: Array.isArray(parsed.events) ? parsed.events.slice(0, 120).map(sanitizeLegacyEvent) : [],
        lidToPhoneMap: parsed.lidToPhoneMap && typeof parsed.lidToPhoneMap === 'object' ? parsed.lidToPhoneMap : {},
        abStats: parsed.abStats && typeof parsed.abStats === 'object' ? { ...DEFAULT_AB_STATS, ...parsed.abStats } : { ...DEFAULT_AB_STATS },
        coupons: parsed.coupons && typeof parsed.coupons === 'object' ? parsed.coupons : {},
        customProducts: Array.isArray(parsed.customProducts) ? parsed.customProducts : [],
      };
    }
  } catch (e) {
    console.warn('Iniciando estado local limpio:', e.message);
  }
  return {
    config: { ...DEFAULT_CONFIG },
    leads: [...DEFAULT_LEADS],
    events: [],
    lidToPhoneMap: {},
    abStats: { ...DEFAULT_AB_STATS },
    coupons: {},
    customProducts: [],
  };
}

let appState = loadState();

function saveState() {
  try {
    const safeConfig = { ...appState.config };
    delete safeConfig.smtpPass;
    delete safeConfig.geminiApiKey;
    const payload = JSON.stringify(
      {
        config: safeConfig,
        leads: appState.leads,
        events: appState.events,
        lidToPhoneMap: appState.lidToPhoneMap,
        abStats: appState.abStats,
        coupons: appState.coupons,
        customProducts: appState.customProducts,
      },
      null,
      2
    );
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, payload, 'utf8');
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (e) {
    console.error('Error guardando estado local:', e.message);
  }
}

// Garantizar migración inicial al archivo atómico en /data
saveState();

const activeSessions = new Map();
const processedSessionIds = new Set();

function fmtMoney(n) {
  const sym = appState?.config?.currencySymbol || 'S/';
  return `${sym} ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function normalizePhoneDigits(phone) {
  let digits = String(phone || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9 && digits.startsWith('9')) digits = '51' + digits;
  return digits;
}

function formatDisplayPhone(phone) {
  const d = normalizePhoneDigits(phone);
  if (!d) return '';
  if (d.startsWith('51') && d.length === 11) {
    return `+51 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  }
  return `+${d}`;
}

function upsertLeadContact(input) {
  const cleanPhone = normalizePhoneDigits(input.phone);
  const cleanEmail = String(input.email || '').trim().toLowerCase();
  const rawFirst = String(input.firstName || '').trim();
  const rawLast = String(input.lastName || '').trim();
  const fullName = String(input.leadName || '').trim();
  const isAnon = !cleanPhone && !cleanEmail;
  if (isAnon) return null;

  const firstName =
    rawFirst && !['Visitante', 'Cliente', 'Explorando'].includes(rawFirst)
      ? rawFirst
      : fullName.split(' ')[0] || 'Lead';
  const lastName =
    rawLast && rawLast !== 'Demo'
      ? rawLast
      : fullName.split(' ').slice(1).join(' ') || '';

  let existing = null;
  if (input.id && Number(input.id) !== 101) {
    existing = appState.leads.find((l) => Number(l.id) === Number(input.id));
  }
  if (!existing && (cleanPhone || cleanEmail)) {
    existing = appState.leads.find((l) => {
      const lp = normalizePhoneDigits(l.phone);
      const le = String(l.email || '').trim().toLowerCase();
      return (
        (cleanPhone && lp && (lp === cleanPhone || lp.slice(-9) === cleanPhone.slice(-9))) ||
        (cleanEmail && le === cleanEmail)
      );
    });
  }

  if (existing) {
    if (firstName && firstName !== 'Lead') existing.firstName = firstName;
    if (lastName) existing.lastName = lastName;
    if (cleanPhone) existing.phone = formatDisplayPhone(cleanPhone);
    if (cleanEmail) existing.email = cleanEmail;
    if (input.district) existing.district = String(input.district).trim();
    if (input.documentNumber) existing.documentNumber = String(input.documentNumber).trim();
    if (input.stage) existing.stage = input.stage;
    if (input.priority) existing.priority = input.priority;
    if (input.notes !== undefined) existing.notes = String(input.notes).trim();
    existing.updatedAt = new Date().toISOString();
    saveState();
    return existing;
  }

  const maxId = appState.leads.reduce((m, l) => Math.max(m, Number(l.id || 0)), 80100);
  const created = {
    id: input.id && Number(input.id) !== 101 ? Number(input.id) : maxId + 1,
    firstName,
    lastName,
    documentNumber: String(input.documentNumber || '00000000').trim(),
    email: cleanEmail,
    phone: formatDisplayPhone(cleanPhone),
    district: String(input.district || 'Trujillo').trim(),
    stage: input.stage || 'LEAD',
    priority: input.priority || 'ALTA',
    notes: String(input.notes || 'Capturado automáticamente').trim(),
    updatedAt: new Date().toISOString(),
  };
  appState.leads.unshift(created);
  appState.leads = appState.leads.slice(0, 250);
  saveState();
  return created;
}

// ----------------------------------------------------------------------------
// 3. MOTOR WHATSAPP REAL (@whiskeysockets/baileys) CON RESOLUCIÓN @lid Y NLU
// ----------------------------------------------------------------------------
const WA_AUTH_DIR = path.join(__dirname, 'wa_auth_session');
let waSock = null;
let waStatus = {
  state: 'DISCONNECTED',
  qrDataUrl: null,
  connectedPhone: null,
  connectedName: null,
  lastError: null,
};

function formatPhoneToJid(phone) {
  const digits = normalizePhoneDigits(phone);
  if (!digits || digits.length < 8) return null;
  return `${digits}@s.whatsapp.net`;
}

function findLatestEventByPhone(senderDigits) {
  if (!senderDigits) return null;
  const mappedDigits = appState.lidToPhoneMap?.[senderDigits] || senderDigits;
  const tail9 = mappedDigits.slice(-9);
  return (
    appState.events.find((ev) => {
      const evDigits = normalizePhoneDigits(ev.leadPhone);
      return (
        evDigits === mappedDigits ||
        (tail9.length === 9 && evDigits.endsWith(tail9)) ||
        (ev.waLid && String(ev.waLid) === String(senderDigits))
      );
    }) || null
  );
}

function getOrCreateCouponForEvent(ev, product) {
  if (ev?.couponCode && appState.coupons[ev.couponCode]) {
    return appState.coupons[ev.couponCode];
  }
  const maxPct = Math.max(1, Math.min(20, Number(appState.config.maxDiscountPercent || 5)));
  const code = `ROO-VIP-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const discountPen = Math.round(Number(product.price || 0) * (maxPct / 100));
  const finalPricePen = Math.max(1, Number(product.price || 0) - discountPen);
  const coupon = {
    code,
    discountPercent: maxPct,
    discountPen,
    finalPricePen,
    productSlug: product.slug,
    expiresAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
  };
  appState.coupons[code] = coupon;
  if (ev) {
    ev.couponCode = code;
    ev.negotiationDiscountPercent = maxPct;
  }
  return coupon;
}

function classifyBuyerIntent(textRaw) {
  const txt = String(textRaw || '').toLowerCase().trim();
  if (/\b(no gracias|no me interesa|ya no|stop|basta|dejar de|no escribir|baja)\b/.test(txt)) return 'OPT_OUT';
  if (/\b(asesor|humano|llamar|llamada|persona|hablar con alguien)\b/.test(txt)) return 'PEDIDO_ASESOR';
  if (/\b(caro|descuento|rebaja|promocion|promoción|oferta|cupon|cupón|mucho dinero|bajar|precio menor)\b/.test(txt)) return 'PRECIO_OBJECION';
  if (/\b(original|garantia|garantía|sellado|imei|serial|confianza|estafa|seguro|seguridad|nuevo)\b/.test(txt)) return 'GARANTIA_CONFIANZA';
  if (/\b(yape|plin|pagar|pago|link|enlace|cuota|cuotas|tarjeta|comprar|separar|reservar|quiero|transferencia)\b/.test(txt)) return 'PAGO_CUOTAS_YAPE';
  if (/\b(stock|disponible|hay|tienen|color|colores|capacidad|gb|tb|caracteristica|especificaciones)\b/.test(txt)) return 'STOCK_VARIANTE';
  if (/\b(tienda|donde|dónde|ubicacion|ubicación|trujillo|envio|envío|delivery|recojo|larco)\b/.test(txt)) return 'TIENDA_ENVIO';
  return 'CONSULTA_GENERAL';
}

function buildDeterministicReply(intent, textRaw, ev) {
  const cfg = appState.config;
  const activeStore = ev?.sourceStore || cfg.storeName;
  const product = ev ? findProduct(ev.productSlug || ev.productName) : findProduct(null);
  const priceStr = fmtMoney(product.price);
  const cuotaStr = fmtMoney(product.installment3);
  const baseCheckout = ev?.trackingClickUrl || ev?.checkoutUrl || cfg.storeUrl || `${PUBLIC_AGENT_URL}/demo-shop.html`;
  const greetingName = ev?.leadFirstName ? `*${ev.leadFirstName}*` : '';

  switch (intent) {
    case 'OPT_OUT':
      if (ev) {
        ev.clientOptOut = true;
        ev.state = 'OPT_OUT';
      }
      return {
        action: 'OPT_OUT',
        intent,
        reply: `Entendido${greetingName ? ' ' + greetingName : ''}, gracias por avisarnos. Desactivamos los recordatorios automáticos para este producto en *${activeStore}*. Cuando quieras volver, aquí estaremos.`,
      };

    case 'PRECIO_OBJECION': {
      const step = Number(ev?.negotiationStep || 0) + 1;
      if (ev) {
        ev.negotiationStep = step;
        ev.state = 'NEGOCIACION_IA';
      }
      if (step <= 1) {
        return {
          action: 'OFFER_INSTALLMENTS',
          intent,
          reply:
            `Te entiendo totalmente${greetingName ? ', ' + greetingName : ''}. Para no descapitalizarte hoy, tienes *3 cuotas sin interés de ${cuotaStr}* (Yape, Plin o tarjeta) y te incluimos *envío express gratis* en Trujillo.\n\n` +
            `Reserva aquí con protección SUNAT: ${baseCheckout}`,
        };
      }
      const coupon = getOrCreateCouponForEvent(ev, product);
      const linkWithCoupon = `${baseCheckout}${baseCheckout.includes('?') ? '&' : '?'}coupon=${coupon.code}`;
      return {
        action: 'GUARDRAIL_DISCOUNT_COUPON',
        intent,
        reply:
          `Como evaluaste el *${product.name}* a detalle, tengo autorización hasta un máximo de *${coupon.discountPercent}% de descuento preferencial* (te ahorras *${fmtMoney(coupon.discountPen)}* → precio final *${fmtMoney(coupon.finalPricePen)}*).\n\n` +
          `Usa tu código exclusivo *${coupon.code}* (vigente 2 horas) directo aquí:\n${linkWithCoupon}`,
      };
    }

    case 'GARANTIA_CONFIANZA':
      return {
        action: 'TRUST_ASSURANCE',
        intent,
        reply:
          `Excelente pregunta${greetingName ? ', ' + greetingName : ''}. Todos nuestros equipos llegan *sellados de fábrica* con número de serie verificable en *checkcoverage.apple.com*, *1 año de garantía oficial* y emisión obligatoria de *Boleta o Factura Electrónica SUNAT*.\n\n` +
          `También puedes verificar y recoger presencialmente en *${cfg.storeAddress}*.\nLink seguro de reserva: ${baseCheckout}`,
      };

    case 'PAGO_CUOTAS_YAPE':
      if (ev) ev.state = 'NEGOCIACION_IA';
      return {
        action: 'SEND_CHECKOUT_LINK',
        intent,
        reply:
          `¡Excelente decisión${greetingName ? ', ' + greetingName : ''}! Puedes completar tu *${product.name}* (${product.color}) por *${priceStr}* (o 3 cuotas sin interés de *${cuotaStr}*) con *Yape, Plin, transferencia BCP/BBVA o tarjeta*.\n\n` +
          `Tu reserva sigue activa aquí con emisión inmediata de comprobante SUNAT:\n${baseCheckout}`,
      };

    case 'STOCK_VARIANTE':
      return {
        action: 'PRODUCT_INFO',
        intent,
        reply:
          `Sí${greetingName ? ', ' + greetingName : ''}: tenemos *${product.stock} unidad(es) en stock* de *${product.name}* (${product.color}, ${product.capacity}). Precio vigente: *${priceStr}* (o 3 cuotas de *${cuotaStr}*).\n\n` +
          `Aparta tu unidad antes que cambie el lote aquí: ${baseCheckout}`,
      };

    case 'TIENDA_ENVIO':
      return {
        action: 'STORE_DELIVERY_INFO',
        intent,
        reply:
          `Nos ubicamos en *${cfg.storeAddress}* y realizamos entregas express aseguradas el mismo día (o recojo presencial verificando serie antes de pagar).\n\n` +
          `Tu carrito guardado para *${product.name}*: ${baseCheckout}`,
      };

    case 'PEDIDO_ASESOR':
      if (ev) ev.state = 'ESCALADO_ASESOR';
      return {
        action: 'ESCALATE_ADVISOR',
        intent,
        reply:
          `Listo${greetingName ? ', ' + greetingName : ''}. Notifiqué ahora mismo con prioridad alta a *${cfg.advisorName}* (${cfg.advisorPhone}) con todo el contexto de tu *${product.name}* para atenderte personalmente.\n\n` +
          `Si deseas avanzar tu reserva mientras te contacta: ${baseCheckout}`,
      };

    default:
      return {
        action: 'GENERAL_ASSIST',
        intent,
        reply:
          `Hola${greetingName ? ' ' + greetingName : ''}, soy el asistente inteligente de *${activeStore}*. Veo tu interés en *${product.name}* (*${priceStr}* · stock: ${product.stock} und.).\n\n` +
          `Puedo ayudarte con *stock/colores, 3 cuotas sin interés, garantía SUNAT, descuentos disponibles o pago por Yape/Plin*. Acceso directo a tu reserva:\n${baseCheckout}`,
      };
  }
}

async function generateSmartReply(textRaw, ev) {
  const intent = classifyBuyerIntent(textRaw);
  const det = buildDeterministicReply(intent, textRaw, ev);

  // Si hay Gemini API Key y no es OPT_OUT ni PEDIDO_ASESOR, intenta redacción LLM acotada al catálogo real
  if (runtimeGeminiKey && intent !== 'OPT_OUT' && intent !== 'PEDIDO_ASESOR') {
    try {
      const cfg = appState.config;
      const activeStore = ev?.sourceStore || cfg.storeName;
      const product = ev ? findProduct(ev.productSlug || ev.productName) : findProduct(null);
      const couponHint =
        ev?.couponCode && appState.coupons[ev.couponCode]
          ? `Cupón activo del cliente: ${ev.couponCode} (${appState.coupons[ev.couponCode].discountPercent}% máx).`
          : `Descuento máximo permitido por política (solo si insiste en precio): ${cfg.maxDiscountPercent}%.`;
      const checkoutUrl = ev?.trackingClickUrl || ev?.checkoutUrl || cfg.storeUrl;
      const sysPrompt =
        `Eres el agente conversacional oficial de ventas de ${activeStore} (${cfg.storeAddress}). ` +
        `Producto evaluado: ${product.name} | Color: ${product.color} | Capacidad: ${product.capacity} | Stock: ${product.stock} | ` +
        `Precio: ${fmtMoney(product.price)} (o 3 cuotas de ${fmtMoney(product.installment3)} sin interés). ${couponHint} ` +
        `Enlace de reserva: ${checkoutUrl}. Reglas estrictas: NUNCA inventes precios ni descuentos mayores al tope, responde en español peruano breve (máx 4 líneas) y termina con llamado claro a la acción.`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(runtimeGeminiKey)}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${sysPrompt}\n\nMensaje del LEAD (${ev?.leadFirstName || 'Cliente'}): "${textRaw}"` }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 240 },
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const llmText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (llmText) {
          return { action: `GEMINI_${det.action}`, intent, reply: llmText };
        }
      }
    } catch {
      // Fallback silencioso a motor NLU determinista
    }
  }
  return det;
}

async function handleIncomingWhatsAppMessages(upsert) {
  if (!upsert || upsert.type !== 'notify' || !Array.isArray(upsert.messages)) return;

  for (const msg of upsert.messages) {
    try {
      if (!msg.key || msg.key.fromMe) continue;
      const remoteJid = msg.key.remoteJid || '';
      if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') continue;

      const textBody =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        '';
      if (!textBody.trim()) continue;

      // Resolver soporte @lid vs @s.whatsapp.net usando remoteJidAlt / lidToPhoneMap
      const rawLeft = remoteJid.split('@')[0].replace(/[^0-9]/g, '');
      const altJid = msg.key.remoteJidAlt || msg.key.participantAlt || '';
      const altDigits = altJid ? normalizePhoneDigits(altJid.split('@')[0]) : '';
      if (remoteJid.endsWith('@lid') && rawLeft && altDigits) {
        appState.lidToPhoneMap[rawLeft] = altDigits;
      }

      const senderDigits = altDigits || appState.lidToPhoneMap[rawLeft] || normalizePhoneDigits(rawLeft);
      const ev = findLatestEventByPhone(senderDigits) || findLatestEventByPhone(rawLeft);

      if (ev) {
        if (remoteJid.endsWith('@lid') && rawLeft) ev.waLid = rawLeft;
        if (!Array.isArray(ev.conversation)) ev.conversation = [];
        ev.conversation.push({ from: 'CLIENT', text: textBody.trim(), at: new Date().toISOString() });
        if (ev.status !== 'CONVERTIDO_PAYER') ev.state = 'EN_CONVERSACION';
      }

      const { action, intent, reply } = await generateSmartReply(textBody, ev);
      await waSock.sendMessage(remoteJid, { text: reply });

      if (ev) {
        ev.conversation.push({ from: 'AGENT', action, intent, text: reply, at: new Date().toISOString() });
        if (intent === 'PEDIDO_ASESOR' && waStatus.state === 'CONNECTED' && appState.config.advisorPhone) {
          const advMsg =
            `*CLIENTE PIDIÓ ATENCIÓN POR WHATSAPP*\n` +
            `*Lead:* ${ev.leadName} (${ev.leadPhone})\n` +
            `*Producto:* ${ev.productName}\n` +
            `*Mensaje:* "${textBody.trim()}"`;
          await sendRealWhatsAppMessage(appState.config.advisorPhone, null, advMsg).catch(() => {});
        }
        saveState();
      }
      console.log(`💬 Respuesta WhatsApp [${intent} -> ${action}] enviada a ${remoteJid}`);
    } catch (err) {
      console.warn('Error procesando mensaje entrante WhatsApp:', err.message);
    }
  }
}

async function initWhatsAppClient() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(WA_AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

    waSock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Roo Retargeting AI', 'Chrome', '126.0.0'],
    });

    waSock.ev.on('creds.update', saveCreds);
    waSock.ev.on('messages.upsert', handleIncomingWhatsAppMessages);

    waSock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        try {
          waStatus.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 260 });
          waStatus.state = 'QR_READY';
        } catch (err) {
          console.error('Error generando QR:', err.message);
        }
      }
      if (connection === 'open') {
        waStatus.state = 'CONNECTED';
        waStatus.qrDataUrl = null;
        waStatus.connectedPhone = waSock.user?.id?.split(':')[0] || 'Conectado';
        waStatus.connectedName = waSock.user?.name || appState.config.storeName;
        waStatus.lastError = null;
        console.log(`✅ WhatsApp Conectado: +${waStatus.connectedPhone}`);
      }
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        waStatus.state = 'DISCONNECTED';
        waStatus.qrDataUrl = null;
        waStatus.connectedPhone = null;

        if (statusCode === DisconnectReason.loggedOut) {
          try {
            fs.rmSync(WA_AUTH_DIR, { recursive: true, force: true });
          } catch (_) {}
          setTimeout(() => initWhatsAppClient(), 1500);
        } else if (shouldReconnect) {
          setTimeout(() => initWhatsAppClient(), 3000);
        }
      }
    });
  } catch (err) {
    waStatus.lastError = err.message;
    console.warn('Aviso iniciando WhatsApp:', err.message);
  }
}

async function sendRealWhatsAppMessage(phone, imageSource, captionText) {
  let jid = formatPhoneToJid(phone);
  if (!jid) return { sent: false, reason: 'Número de teléfono inválido (mín. 8 dígitos)' };
  if (!waSock || waStatus.state !== 'CONNECTED') {
    return { sent: false, reason: 'WhatsApp aún no vinculado con QR (Escanea el QR en la Torre)' };
  }

  try {
    const check = await waSock.onWhatsApp(jid).catch(() => []);
    if (Array.isArray(check) && check.length > 0) {
      if (!check[0].exists) {
        return { sent: false, reason: `El número ${phone} no tiene cuenta activa en WhatsApp.` };
      }
      jid = check[0].jid || jid;
      const jidDigits = jid.split('@')[0].replace(/[^0-9]/g, '');
      const phoneDigits = normalizePhoneDigits(phone);
      if (jid.endsWith('@lid') && jidDigits && phoneDigits) {
        appState.lidToPhoneMap[jidDigits] = phoneDigits;
        saveState();
      }
    }

    if (imageSource && typeof imageSource === 'string' && !imageSource.startsWith('http') && fs.existsSync(imageSource)) {
      const mediaBuf = fs.readFileSync(imageSource);
      await waSock.sendMessage(jid, { image: mediaBuf, caption: captionText });
      return { sent: true, jid, withImage: true, timestamp: new Date().toISOString() };
    }

    await waSock.sendMessage(jid, { text: captionText });
    return { sent: true, jid, withImage: false, timestamp: new Date().toISOString() };
  } catch (err) {
    try {
      await waSock.sendMessage(jid, { text: captionText });
      return { sent: true, jid, textOnly: true, timestamp: new Date().toISOString() };
    } catch (err2) {
      return { sent: false, reason: err2.message };
    }
  }
}

// ----------------------------------------------------------------------------
// 4. MOTOR SMTP REAL (GMAIL 465/587 + ETHEREAL DE RESPALDO + PÍXEL TRACKING)
// ----------------------------------------------------------------------------
let mailTransporter = null;
let mailAccountInfo = { mode: 'INITIALIZING', user: '', lastError: null };

async function initMailer() {
  const cfg = appState.config || {};
  const smtpUser = (cfg.smtpUser || process.env.SMTP_USER || '').trim();
  const smtpPass = (runtimeSmtpPass || process.env.SMTP_PASS || '').trim();
  const smtpHost = (cfg.smtpHost || 'smtp.gmail.com').trim();
  const smtpPort = Number(cfg.smtpPort || 465);

  try {
    if (smtpUser && smtpPass) {
      mailTransporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
      });
      await mailTransporter.verify();
      mailAccountInfo = { mode: 'GMAIL_REAL_SMTP', user: smtpUser, port: smtpPort, lastError: null };
      console.log(`📧 SMTP Real activo (${smtpUser} @ ${smtpHost}:${smtpPort})`);
      return;
    }

    const testAccount = await nodemailer.createTestAccount();
    mailTransporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    mailAccountInfo = { mode: 'ETHEREAL_SMTP_FALLBACK', user: testAccount.user, lastError: null };
    console.log(`📧 SMTP Ethereal de respaldo activo (${testAccount.user}).`);
  } catch (e) {
    mailAccountInfo = { mode: 'SMTP_ERROR', user: smtpUser, lastError: e.message };
    console.warn('⚠️ Error iniciando SMTP:', e.message);
  }
}

function buildRealAbandonedEmailHtml({ lead, product, clickUrl, pixelUrl, customImgSrc, strategyLabel, coupon, storeNameOverride }) {
  const cfg = appState.config;
  const activeStore = storeNameOverride || cfg.storeName || 'Tienda Demo · roo';
  const firstNameUpper = (lead.firstName || 'CLIENTE').toUpperCase();
  const formattedPrice = fmtMoney(coupon ? coupon.finalPricePen : product.price);
  const formattedInstallment = fmtMoney(product.installment3);
  const imgSrc = customImgSrc || product.emailImageUrl || product.image;
  const badgeLine = coupon
    ? `Código exclusivo ${coupon.code} (${coupon.discountPercent}% OFF aplicado)`
    : `${strategyLabel || 'Reserva prioritaria'} · Garantía 1 año`;

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Tu reserva en ${activeStore}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:24px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color:#0f172a;padding:18px 28px;color:#ffffff;">
              <div style="font-size:11px;color:#f4c58f;text-transform:uppercase;letter-spacing:1.2px;font-weight:700;">${activeStore}</div>
              <div style="font-size:20px;font-weight:800;margin-top:4px;">Tu selección sigue reservada</div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:30px 28px;text-align:center;">
              <div style="font-size:11px;font-weight:700;color:#1d4ed8;background:#eff6ff;display:inline-block;padding:4px 12px;border-radius:999px;margin-bottom:10px;">${badgeLine}</div>
              <h2 style="font-size:21px;font-weight:600;color:#111827;margin:6px 0 14px 0;">Hola, ${firstNameUpper}</h2>
              <p style="font-size:15px;line-height:1.5;color:#374151;margin:0 0 16px 0;">
                Notamos que revisaste <strong>${product.name}</strong> (${product.color}) y dejamos tu unidad apartada con despacho express y comprobante electrónico SUNAT.
              </p>
              <div style="background:#f8fafc;border-radius:14px;padding:18px;margin-bottom:22px;border:1px solid #e2e8f0;">
                <img src="${imgSrc}" alt="${product.name}" style="max-width:290px;width:100%;height:190px;object-fit:contain;background:#ffffff;padding:8px;border-radius:12px;display:block;margin:0 auto 12px auto;" />
                <div style="font-size:17px;font-weight:700;color:#0f172a;">${product.name}</div>
                <div style="font-size:19px;font-weight:800;color:#1d4ed8;margin-top:6px;">
                  ${formattedPrice} <span style="font-size:13px;font-weight:500;color:#475569;">o 3 cuotas sin interés de ${formattedInstallment}</span>
                </div>
              </div>
              <a href="${clickUrl}" style="display:inline-block;background-color:#059669;color:#ffffff;font-weight:700;font-size:15px;text-decoration:none;padding:14px 32px;border-radius:999px;">
                Completar mi reserva ahora
              </a>
              <p style="font-size:11.5px;color:#94a3b8;margin-top:20px;">${cfg.storeAddress}</p>
              <p style="font-size:10.5px;color:#94a3b8;margin-top:6px;">Automatización inteligente por <strong>roo | Soluciones Digitales</strong> · Tecnología con Propósito</p>
              ${pixelUrl ? `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;" />` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

async function sendRecoveryEmail({ lead, product, clickUrl, pixelUrl, strategyLabel, coupon, subjectOverride, storeNameOverride }) {
  const cfg = appState.config;
  const activeStore = storeNameOverride || cfg.storeName || 'Tienda Demo · roo';
  const hasLocalMedia = Boolean(product.localMediaPath && fs.existsSync(product.localMediaPath));
  const htmlContent = buildRealAbandonedEmailHtml({
    lead,
    product,
    clickUrl,
    pixelUrl,
    customImgSrc: hasLocalMedia ? 'cid:roo-product' : undefined,
    strategyLabel,
    coupon,
    storeNameOverride: activeStore,
  });

  if (!mailTransporter || !lead.email) {
    return {
      delivery: {
        sent: false,
        reason: mailAccountInfo.lastError || (!lead.email ? 'Sin correo destino' : 'Transporte SMTP no inicializado'),
      },
      htmlContent,
      previewUrl: null,
    };
  }

  try {
    const senderAddr = (cfg.smtpUser || process.env.SMTP_USER || 'notificaciones@roo-digital.pe').trim();
    const mailOpts = {
      from: `"${activeStore.replace(/[^\w\s.\-áéíóúÁÉÍÓÚñÑ]/g, '')}" <${senderAddr}>`,
      to: lead.email,
      subject: subjectOverride || `Tu reserva de ${product.shortName || product.name} en ${activeStore}`,
      html: htmlContent,
    };
    if (hasLocalMedia) {
      mailOpts.attachments = [
        {
          filename: path.basename(product.localMediaPath),
          path: product.localMediaPath,
          cid: 'roo-product',
        },
      ];
    }
    const info = await mailTransporter.sendMail(mailOpts);
    const previewUrl = nodemailer.getTestMessageUrl(info) || null;
    return {
      delivery: {
        sent: true,
        mode: mailAccountInfo.mode,
        recipient: lead.email,
        messageId: info.messageId,
        previewUrl,
      },
      htmlContent,
      previewUrl,
    };
  } catch (err) {
    return {
      delivery: { sent: false, reason: err.message },
      htmlContent,
      previewUrl: null,
    };
  }
}

// ----------------------------------------------------------------------------
// 5. CONEXIÓN OPCIONAL A SQL SERVER (CERO DDL - SOLO DML TRANSACCIONAL)
// ----------------------------------------------------------------------------
const dbConfig = {
  server: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || '',
  options: { encrypt: false, trustServerCertificate: true },
  pool: { max: 5, min: 0, idleTimeoutMillis: 15000 },
};

let sqlPool = null;
let sqlConnected = false;

async function initSqlConnection() {
  if (!dbConfig.user || !dbConfig.password || !dbConfig.database) {
    sqlConnected = false;
    console.log('ℹ️ Operando 100% en almacenamiento local JSON (Modo Zero-DDL · SQL Server opcional no configurado).');
    return;
  }
  try {
    sqlPool = await sql.connect(dbConfig);
    // Solo verifica conectividad mediante SELECT de lectura (Zero-DDL)
    await sqlPool.request().query('SELECT TOP 1 id_persona FROM core.persona;');
    sqlConnected = true;
    console.log(`✅ Conectado a SQL Server (${dbConfig.database}) (Modo Zero-DDL · solo lectura y DML transición LEAD->PAYER).`);
  } catch (err) {
    sqlConnected = false;
    console.log('ℹ️ Operando 100% en almacenamiento local JSON (SQL Server no requerido):', err.message);
  }
}

// ----------------------------------------------------------------------------
// 6. MOTOR XAI, APRENDIZAJE A/B, QUIET HOURS Y FALLBACK CROSS-CHANNEL
// ----------------------------------------------------------------------------
function isWithinQuietHours(date = new Date()) {
  const cfg = appState.config;
  if (!cfg.quietHoursEnabled) return false;
  const h = date.getHours();
  const start = Number(cfg.quietHoursStart ?? 22);
  const end = Number(cfg.quietHoursEnd ?? 7);
  return start > end ? h >= start || h < end : h >= start && h < end;
}

function selectAbStrategy(tier) {
  const keys = Object.keys(appState.abStats || DEFAULT_AB_STATS);
  // Exploración 20% o cuando hay pocos datos; 80% explotación por mayor tasa de cierre real
  const totalSent = keys.reduce((acc, k) => acc + Number(appState.abStats[k]?.sent || 0), 0);
  if (totalSent < keys.length * 2 || Math.random() < 0.2) {
    if (tier === 'ENTRE_5_Y_10_MIN') return 'FACILIDAD_CUOTAS';
    if (tier === 'MAYOR_10_MIN') return 'INCENTIVO_VIP';
    const picked = keys[totalSent % keys.length];
    return picked;
  }
  let bestKey = keys[0];
  let bestRate = -1;
  for (const k of keys) {
    const s = appState.abStats[k] || { sent: 0, converted: 0 };
    const rate = s.sent > 0 ? s.converted / s.sent : 0;
    if (rate > bestRate) {
      bestRate = rate;
      bestKey = k;
    }
  }
  return bestKey;
}

function calculateIntentAnalysis(secondsViewed, interactions, product, context = {}) {
  const emailMax = Number(appState.config.emailMaxSeconds || 300);
  const waMax = Number(appState.config.whatsappMaxSeconds || 600);
  const secs = Math.max(5, Number(secondsViewed || 0));
  const signals = interactions || {};

  let bonus = 0;
  const reasons = [];
  if (signals.openedCheckout) {
    bonus += 16;
    reasons.push('Abrió pasarela sin pagar (+16%)');
  }
  if (signals.openedQuote) {
    bonus += 10;
    reasons.push('Inició cotización (+10%)');
  }
  if (Number(signals.cartCount || 0) > 0) {
    bonus += 12;
    reasons.push(`Bolsa activa con ${signals.cartCount} ítem(s) (+12%)`);
  }
  if (Number(signals.comparedCount || 0) >= 2) {
    bonus += 6;
    reasons.push(`Comparó ${signals.comparedCount} equipos (+6%)`);
  }
  if (Number(signals.productsViewed || 1) >= 2) {
    bonus += 5;
    reasons.push(`Exploró ${signals.productsViewed} modelos (+5%)`);
  }
  if (Number(product?.price || 0) >= 4000) {
    bonus += 4;
    reasons.push('Ticket alto Apple Pro/Mac (+4%)');
  }
  if (context.isReturningLead) {
    bonus += 7;
    reasons.push('Visitante recurrente (+7%)');
  }

  let tier = '';
  let preferredChannel = '';
  let intentLevel = '';
  let baseProb = 0;

  if (secs < emailMax) {
    tier = 'MENOR_5_MIN';
    preferredChannel = 'CORREO_HTML';
    intentLevel = 'EXPLORATORIA';
    baseProb = Math.round(24 + (secs / emailMax) * 20);
    reasons.unshift(`Permanencia exploratoria (< ${Math.round(emailMax / 60)} min)`);
  } else if (secs <= waMax) {
    tier = 'ENTRE_5_Y_10_MIN';
    preferredChannel = 'WHATSAPP_DIRECTO';
    intentLevel = 'COMPRA_POSIBLE';
    baseProb = Math.round(62 + ((secs - emailMax) / Math.max(1, waMax - emailMax)) * 18);
    reasons.unshift(`Permanencia intermedia (${Math.round(emailMax / 60)}–${Math.round(waMax / 60)} min)`);
  } else {
    tier = 'MAYOR_10_MIN';
    preferredChannel = 'ALERTA_ASESOR_LLAMADA';
    intentLevel = 'COMPRA_MUY_POSIBLE';
    baseProb = Math.round(85 + Math.min(10, (secs - waMax) / 60));
    reasons.unshift(`Permanencia crítica (> ${Math.round(waMax / 60)} min)`);
  }

  const probability = Math.min(99, Math.max(20, baseProb + bonus));
  const decisionTrace = [...reasons];

  // Regla inteligente de Fallback Cross-Channel previo al envío
  let channel = preferredChannel;
  const hasPhone = Boolean(normalizePhoneDigits(context.phone));
  const hasEmail = Boolean(String(context.email || '').includes('@'));
  const hasWaConnected = waStatus.state === 'CONNECTED';

  if (channel === 'CORREO_HTML' && !hasEmail && hasPhone) {
    channel = 'WHATSAPP_DIRECTO';
    decisionTrace.push('Fallback XAI: Sin correo válido → conmutado a WhatsApp Directo');
  } else if (channel === 'WHATSAPP_DIRECTO' && (!hasPhone || !hasWaConnected) && hasEmail) {
    channel = 'CORREO_HTML';
    decisionTrace.push(`Fallback XAI: WhatsApp ${!hasPhone ? 'sin número' : 'desconectado'} → conmutado a Correo HTML`);
  }

  const strategyKey = selectAbStrategy(tier);
  const strategyLabel = appState.abStats[strategyKey]?.label || strategyKey;
  decisionTrace.push(`Estrategia A/B seleccionada: ${strategyLabel}`);

  return { tier, preferredChannel, channel, intentLevel, probability, reasons, decisionTrace, strategyKey, strategyLabel };
}

function getDailyContactCount(phone, email) {
  const cleanPhone = normalizePhoneDigits(phone);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const since = Date.now() - 24 * 3600 * 1000;
  return appState.events.filter((ev) => {
    if (new Date(ev.createdAt).getTime() < since) return false;
    const ep = normalizePhoneDigits(ev.leadPhone);
    const ee = String(ev.leadEmail || '').trim().toLowerCase();
    return (cleanPhone && ep && ep.slice(-9) === cleanPhone.slice(-9)) || (cleanEmail && ee === cleanEmail);
  }).length;
}

function isUnderCooldown(phone, email, productSlug) {
  const cooldownMs = Number(appState.config.cooldownMinutes || 10) * 60 * 1000;
  const cleanPhone = normalizePhoneDigits(phone);
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanPhone && !cleanEmail) return false;
  const now = Date.now();

  return appState.events.some((ev) => {
    const evPhone = normalizePhoneDigits(ev.leadPhone);
    const samePhone = cleanPhone && evPhone && (evPhone === cleanPhone || evPhone.slice(-9) === cleanPhone.slice(-9));
    const sameEmail = cleanEmail && String(ev.leadEmail || '').trim().toLowerCase() === cleanEmail;
    if (!samePhone && !sameEmail) return false;
    if (ev.clientOptOut) return true;
    if (cooldownMs <= 0) return false;
    const ageMs = now - new Date(ev.createdAt).getTime();
    return ageMs <= cooldownMs && ev.productSlug === productSlug;
  });
}

async function processRealAbandonment(payload) {
  const targetPhone = (payload.phone || '').trim();
  const targetEmail = (payload.email || '').trim();
  const rawFirst = (payload.firstName || (payload.leadName || '').split(' ')[0] || '').trim();
  const rawLast = (payload.lastName || (payload.leadName || '').split(' ').slice(1).join(' ') || '').trim();
  const isAnonPlaceholder = !targetPhone && !targetEmail && (!rawFirst || rawFirst === 'Visitante' || rawFirst === 'Cliente');

  // Guardar/Actualizar contacto inmediatamente en el directorio local persistente si trae teléfono o correo
  let lead = null;
  if (!isAnonPlaceholder) {
    lead = upsertLeadContact({
      id: payload.leadId,
      firstName: rawFirst,
      lastName: rawLast,
      leadName: payload.leadName,
      phone: targetPhone,
      email: targetEmail,
      documentNumber: payload.documentNumber,
      district: payload.district,
      notes: payload.sourceStore ? `Origen: ${payload.sourceStore}` : undefined,
    });
  } else if (appState.leads.length) {
    lead = appState.leads[0];
  }

  if (!lead) {
    lead = {
      id: Number(payload.leadId || 80003),
      firstName: 'Usuario',
      lastName: 'Demo',
      documentNumber: '00000001',
      email: 'demo.lead1@example.com',
      phone: '+51 900 000 001',
      district: 'Trujillo',
      stage: 'LEAD',
    };
  }

  const targetFirstName = isAnonPlaceholder ? lead.firstName : rawFirst || lead.firstName || 'Cliente';
  const targetLastName = isAnonPlaceholder ? lead.lastName : rawLast || lead.lastName || '';
  const fullName = `${targetFirstName} ${targetLastName}`.trim();
  const finalPhone = formatDisplayPhone(targetPhone || lead.phone);
  const finalEmail = targetEmail || lead.email;

  const cartItems = Array.isArray(payload.cartItems) ? payload.cartItems : [];
  const product = findProduct(payload.productSlug || payload.productId || payload.productName || cartItems[0]?.slug);
  const cartTotal =
    Number(payload.cartTotal || 0) ||
    (cartItems.length
      ? cartItems.reduce((acc, it) => acc + Number(it.pricePen || product.price) * Number(it.qty || 1), 0)
      : product.price);
  const secs = Math.max(5, Number(payload.secondsViewed || 120));
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  const durationLabel = `${mm}:${ss} min (${secs} seg)`;

  if (!payload.bypassCooldown && isUnderCooldown(finalPhone, finalEmail, product.slug)) {
    return { skippedCooldown: true, reason: `Cooldown anti-spam activo (${appState.config.cooldownMinutes} min)` };
  }

  if (!payload.bypassCooldown && getDailyContactCount(finalPhone, finalEmail) >= Number(appState.config.dailyCapPerLead || 6)) {
    return { skippedCooldown: true, reason: `Tope diario anti-fatiga alcanzado para ${fullName}` };
  }

  const isReturningLead = appState.events.some(
    (e) =>
      (normalizePhoneDigits(finalPhone) && normalizePhoneDigits(e.leadPhone) === normalizePhoneDigits(finalPhone)) ||
      (finalEmail && String(e.leadEmail || '').toLowerCase() === finalEmail.toLowerCase())
  );

  const enrichedInteractions = {
    ...(payload.interactions || {}),
    cartCount: cartItems.length || Number(payload.interactions?.cartCount || 0),
    comparedCount: Array.isArray(payload.comparedModels) ? payload.comparedModels.length : 0,
  };

  const analysis = calculateIntentAnalysis(secs, enrichedInteractions, product, {
    phone: finalPhone,
    email: finalEmail,
    isReturningLead,
  });

  const recoverToken = `ROO-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const reservationExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const activeStore = (payload.sourceStore || appState.config.storeName || 'Tienda Demo · roo').trim();
  const defaultStoreUrl = appState.config.storeUrl || `${PUBLIC_AGENT_URL}/demo-shop.html`;
  const baseStoreUrl = (payload.returnUrl || defaultStoreUrl).split('?')[0];
  const storeCheckoutUrl = `${baseStoreUrl}?recover=${recoverToken}&product=${product.slug}`;
  const trackingClickUrl = `${PUBLIC_AGENT_URL}/r/${recoverToken}`;
  const trackingPixelUrl = `${PUBLIC_AGENT_URL}/t/o/${recoverToken}.png`;

  const firstNameUpper = targetFirstName.toUpperCase();
  const formattedPrice = fmtMoney(product.price);
  const cuota3 = fmtMoney(product.installment3);

  let channel = analysis.channel;
  let headline = '';
  let messageBody = '';
  let deliveryResult = {};
  let emailPreviewUrl = null;
  let emailHtml = null;
  let advisorScript = null;
  const conversation = [];
  const decisionTrace = [...analysis.decisionTrace];

  if (!payload.bypassCooldown && isWithinQuietHours()) {
    decisionTrace.push('Horario silencioso activo: entrega diferida en cola');
  }

  const dispatchEmail = async () => {
    const out = await sendRecoveryEmail({
      lead: { ...lead, firstName: targetFirstName, email: finalEmail },
      product,
      clickUrl: trackingClickUrl,
      pixelUrl: trackingPixelUrl,
      strategyLabel: analysis.strategyLabel,
      storeNameOverride: activeStore,
    });
    emailHtml = out.htmlContent;
    emailPreviewUrl = out.previewUrl;
    return out.delivery;
  };

  const dispatchWhatsApp = async () => {
    const strategyLine =
      analysis.strategyKey === 'URGENCIA_STOCK'
        ? `Quedan solo *${product.stock} unidad(es)* en bodega.`
        : analysis.strategyKey === 'FACILIDAD_CUOTAS'
        ? `Puedes separarlo en *3 cuotas sin interés de ${cuota3}*.`
        : `Incluye *envío express asegurado* + comprobante SUNAT.`;

    const waCaption =
      `*${activeStore}*\n\n` +
      `Hola *${firstNameUpper}*, vimos que evaluaste el *${product.name}* (${product.color}, ${product.capacity}) por *${formattedPrice}*.\n` +
      `${strategyLine}\n\n` +
      `Tu reserva exclusiva sigue activa por 15 min aquí:\n${trackingClickUrl}\n\n` +
      `_Responde a este mensaje para consultar stock, descuentos o pagar con Yape/Plin._`;

    messageBody = waCaption;
    const waMedia = product.localMediaPath && fs.existsSync(product.localMediaPath) ? product.localMediaPath : null;
    const res = await sendRealWhatsAppMessage(finalPhone, waMedia, waCaption);
    conversation.push({ from: 'AGENT', action: 'TOQUE_1_RECOVERY', text: waCaption, at: new Date().toISOString() });
    return res;
  };

  if (channel === 'CORREO_HTML') {
    headline = `Correo de recuperación enviado a ${finalEmail}`;
    messageBody = `Tu selección ${product.name} (${formattedPrice}) sigue reservada (${analysis.strategyLabel}).`;
    deliveryResult = await dispatchEmail();

    // Cascada automática si falló SMTP y hay WhatsApp conectado + teléfono
    if (!deliveryResult.sent && waStatus.state === 'CONNECTED' && normalizePhoneDigits(finalPhone)) {
      decisionTrace.push(`Cascada automática: Falló SMTP (${deliveryResult.reason}) → reenviado por WhatsApp`);
      channel = 'WHATSAPP_DIRECTO';
      headline = `WhatsApp (cascada tras correo) enviado a ${finalPhone}`;
      deliveryResult = await dispatchWhatsApp();
    }
  } else if (channel === 'WHATSAPP_DIRECTO') {
    headline = `WhatsApp oficial enviado a ${finalPhone}`;
    deliveryResult = await dispatchWhatsApp();

    if (!deliveryResult.sent && finalEmail && finalEmail.includes('@')) {
      decisionTrace.push(`Cascada automática: Falló WhatsApp (${deliveryResult.reason}) → reenviado por Correo HTML`);
      channel = 'CORREO_HTML';
      headline = `Correo (cascada tras WhatsApp) enviado a ${finalEmail}`;
      messageBody = `Tu selección ${product.name} (${formattedPrice}) sigue reservada (${analysis.strategyLabel}).`;
      deliveryResult = await dispatchEmail();
    }
  } else {
    headline = `Alerta urgente enviada al Asesor (${appState.config.advisorPhone}) para llamar a ${fullName}`;
    const advisorAlertText =
      `*ALERTA ${activeStore.toUpperCase()} — COMPRA MUY POSIBLE (>10 MIN)*\n\n` +
      `Lead: ${fullName}\n` +
      `Tiempo revisando: ${durationLabel}\n` +
      `Score de Intención: ${analysis.probability}%\n` +
      `Producto: ${product.name} (${formattedPrice})\n` +
      `Llamar al cliente: ${finalPhone}\n` +
      `Link directo: ${trackingClickUrl}`;

    messageBody = advisorAlertText;
    advisorScript = {
      advisorName: appState.config.advisorName,
      advisorPhone: appState.config.advisorPhone,
      clientPhone: finalPhone,
      opening: `Hola ${targetFirstName}, te saluda ${appState.config.advisorName} de ${activeStore}. Notamos tu interés en el ${product.name} y queremos ayudarte a reservar tu unidad.`,
      closingOffer: `Podemos activarte 3 cuotas sin intereses de ${cuota3} o pago por Yape/Plin con entrega certificada.`,
    };
    const waAdvisorMedia = product.localMediaPath && fs.existsSync(product.localMediaPath) ? product.localMediaPath : null;
    deliveryResult = await sendRealWhatsAppMessage(appState.config.advisorPhone, waAdvisorMedia, advisorAlertText);
  }

  // Registrar estadística A/B
  if (appState.abStats[analysis.strategyKey]) {
    appState.abStats[analysis.strategyKey].sent += 1;
  }

  // DML opcional solo sobre tablas existentes si SQL Server está conectado (CERO DDL)
  if (sqlConnected && sqlPool) {
    try {
      await sqlPool
        .request()
        .input('idPersona', sql.BigInt, lead.id)
        .input('decision', sql.NVarChar(sql.MAX), `[${analysis.tier} · ${analysis.strategyKey}] ${headline}`)
        .input('sustento', sql.NVarChar(sql.MAX), JSON.stringify({ secs, decisionTrace, deliveryResult }))
        .input('confianza', sql.Decimal(5, 2), analysis.probability)
        .query(`
          IF EXISTS (SELECT 1 FROM core.persona WHERE id_persona = @idPersona)
          BEGIN
            DECLARE @idAg SMALLINT = ISNULL((SELECT TOP 1 id_agente FROM core.agente_ia WHERE codigo_agente = 'AGT_RETARGETING_LP'), 3);
            INSERT INTO core.accion_agente
              (id_agente, id_persona, tipo_accion, entidad_afectada, id_entidad_afectada,
               decision_tomada, datos_sustento_json, nivel_confianza_ia, requirio_aprobacion, resultado_ejecucion)
            VALUES
              (@idAg, @idPersona, 'RETARGETING_ABANDONO', 'persona', @idPersona,
               @decision, @sustento, @confianza, 0, 'EXITOSO');
          END;
        `)
        .catch(() => {});

      if (analysis.tier === 'MAYOR_10_MIN') {
        await sqlPool
          .request()
          .input('idPersona', sql.BigInt, lead.id)
          .input('accion', sql.NVarChar(300), `LLAMAR AHORA A ${fullName} (${finalPhone}): ${durationLabel} en ${product.name} (${analysis.probability}% prob.).`)
          .query(`
            IF EXISTS (SELECT 1 FROM core.persona WHERE id_persona = @idPersona)
            BEGIN
              INSERT INTO core.alerta_operativa
                (fase, codigo_tipo_alerta, id_persona, id_entidad_referencia, tipo_entidad_referencia, accion_recomendada, rol_responsable, estado_alerta)
              VALUES
                ('LEADS', 'ABANDONO_ALTA_INTENCION_MAS_10M', @idPersona, @idPersona, 'persona', @accion, 'COMERCIAL', 'ACTIVA');
            END;
          `)
          .catch(() => {});
      }
    } catch (_) {}
  }

  const cleanClientPhone = normalizePhoneDigits(finalPhone);
  const eventRecord = {
    id: Date.now(),
    recoverToken,
    reservationExpiresAt,
    leadId: lead.id,
    leadName: fullName,
    leadFirstName: targetFirstName,
    leadDocumentNumber: lead.documentNumber || '00000000',
    leadEmail: finalEmail,
    leadPhone: finalPhone,
    leadDistrict: lead.district || 'Trujillo',
    sourceStore: payload.sourceStore || appState.config.storeName,
    productId: product.id,
    productSlug: product.slug,
    productName: product.name,
    productColor: product.color,
    productPrice: product.price,
    productImage: product.image,
    cartItems,
    cartTotal,
    focusedProduct: payload.focusedProduct || null,
    comparedModels: Array.isArray(payload.comparedModels) ? payload.comparedModels : [],
    customerLoggedIn: Boolean(payload.customerLoggedIn),
    secondsViewed: secs,
    durationLabel,
    exitReason: payload.exitReason || 'ABANDONO_DETECTADO',
    tier: analysis.tier,
    channel,
    intentLevel: analysis.intentLevel,
    probability: analysis.probability,
    strategyKey: analysis.strategyKey,
    strategyLabel: analysis.strategyLabel,
    intentReasons: analysis.reasons,
    decisionTrace,
    state: 'TOQUE_1_ENVIADO',
    headline,
    messageBody,
    emailHtml,
    emailPreviewUrl,
    openedAt: null,
    clickedAt: null,
    touch2SentAt: null,
    couponCode: null,
    negotiationStep: 0,
    advisorScript,
    advisorClaimedAt: null,
    slaSeconds: null,
    conversation,
    deliveryResult,
    waManualFallbackUrl: cleanClientPhone ? `https://wa.me/${cleanClientPhone}?text=${encodeURIComponent(messageBody)}` : null,
    telCallUrl: finalPhone ? `tel:${finalPhone}` : null,
    checkoutUrl: storeCheckoutUrl,
    trackingClickUrl,
    status: 'ENVIADO',
    paymentInfo: null,
    createdAt: new Date().toISOString(),
  };

  appState.events.unshift(eventRecord);
  appState.events = appState.events.slice(0, 120);
  saveState();

  return eventRecord;
}

// Sweeper Autónomo: detecta sesiones abandonadas y ejecuta Cadencia Multi-Toque (Toque 2)
function startAbandonmentSweeper() {
  setInterval(async () => {
    const now = Date.now();
    const timeoutMs = Number(appState.config.abandonTimeoutSeconds || 25) * 1000;

    for (const [sessionId, session] of activeSessions.entries()) {
      const idleMs = now - new Date(session.updatedAt).getTime();
      if (idleMs >= timeoutMs) {
        activeSessions.delete(sessionId);
        if (session.purchased || processedSessionIds.has(sessionId)) continue;
        const hasContact = Boolean((session.phone && session.phone.trim()) || (session.email && session.email.trim()));
        if (!hasContact || Number(session.secondsViewed || 0) < 5) continue;

        processedSessionIds.add(sessionId);
        console.log(`⚡ [Sweeper] Abandono tras ${Math.round(idleMs / 1000)}s: ${session.leadName} (${session.productName})`);
        await processRealAbandonment({
          sessionId,
          leadId: session.leadId,
          firstName: session.leadName.split(' ')[0],
          lastName: session.leadName.split(' ').slice(1).join(' '),
          phone: session.phone,
          email: session.email,
          sourceStore: session.sourceStore,
          returnUrl: session.returnUrl,
          productSlug: session.productSlug,
          productName: session.productName,
          cartItems: session.cartItems || [],
          cartTotal: session.cartTotal || 0,
          focusedProduct: session.focusedProduct || null,
          comparedModels: session.comparedModels || [],
          customerLoggedIn: Boolean(session.customerLoggedIn),
          secondsViewed: session.secondsViewed,
          interactions: session.interactions,
          exitReason: 'INACTIVIDAD_AUTONOMA_SERVIDOR',
        }).catch((err) => console.warn('Error en sweeper:', err.message));
      }
    }

    // Cadencia Multi-Toque: si Toque 1 sigue sin apertura/clic después de touch2DelaySeconds, envía Toque 2 con incentivo
    const touch2Ms = Number(appState.config.touch2DelaySeconds || 180) * 1000;
    if (touch2Ms >= 30000 && !isWithinQuietHours()) {
      for (const ev of appState.events) {
        if (
          ev.status !== 'CONVERTIDO_PAYER' &&
          !ev.clientOptOut &&
          !ev.touch2SentAt &&
          !ev.clickedAt &&
          ev.state === 'TOQUE_1_ENVIADO' &&
          now - new Date(ev.createdAt).getTime() >= touch2Ms
        ) {
          ev.touch2SentAt = new Date().toISOString();
          const product = findProduct(ev.productSlug || ev.productName);
          const coupon = getOrCreateCouponForEvent(ev, product);
          ev.state = 'TOQUE_2_INCENTIVO';
          const activeStore = ev.sourceStore || appState.config.storeName;
          const followText =
            `*${activeStore} · Seguimiento VIP*\n\n` +
            `Hola *${ev.leadFirstName || 'Cliente'}*, tu *${product.name}* sigue reservado y activamos tu beneficio exclusivo *${coupon.code}* (*${coupon.discountPercent}% OFF* → *${fmtMoney(coupon.finalPricePen)}*).\n\n` +
            `Canjéalo aquí antes que expire: ${ev.trackingClickUrl}?coupon=${coupon.code}`;

          if (ev.channel === 'CORREO_HTML' && waStatus.state === 'CONNECTED' && normalizePhoneDigits(ev.leadPhone)) {
            await sendRealWhatsAppMessage(ev.leadPhone, null, followText);
            ev.conversation.push({ from: 'AGENT', action: 'TOQUE_2_CROSS_WA', text: followText, at: ev.touch2SentAt });
            ev.decisionTrace.push('Toque 2 autónomo: Sin clic en correo → WhatsApp con cupón ' + coupon.code);
          } else if (ev.leadEmail && ev.leadEmail.includes('@')) {
            const em = await sendRecoveryEmail({
              lead: { firstName: ev.leadFirstName, email: ev.leadEmail },
              product,
              clickUrl: `${ev.trackingClickUrl}?coupon=${coupon.code}`,
              pixelUrl: `${PUBLIC_AGENT_URL}/t/o/${ev.recoverToken}.png`,
              strategyLabel: `Seguimiento VIP (${coupon.discountPercent}% OFF)`,
              coupon,
              subjectOverride: `Beneficio exclusivo ${coupon.code} para tu ${product.shortName || product.name}`,
              storeNameOverride: activeStore,
            });
            ev.emailHtml = em.htmlContent;
            ev.decisionTrace.push('Toque 2 autónomo: Cupón ' + coupon.code + ' enviado por correo');
          }
          saveState();
        }
      }
    }
  }, 10000);
}

// ----------------------------------------------------------------------------
// 7. CONVERSIÓN LEAD -> PAYER (JSON LOCAL + DML TRANSACCIONAL OPCIONAL EN SQL)
// ----------------------------------------------------------------------------
async function convertLeadToPayerInDb(eventOrId, paymentDto = {}) {
  let ev = null;
  if (typeof eventOrId === 'object' && eventOrId !== null) {
    ev = eventOrId;
  } else {
    ev = appState.events.find((e) => Number(e.id) === Number(eventOrId) || e.recoverToken === String(eventOrId));
  }
  if (!ev) throw new Error('Registro de abandono no encontrado');
  if (ev.status === 'CONVERTIDO_PAYER') return ev;

  const method = (paymentDto.paymentMethod || 'YAPE').toUpperCase();
  const coupon = ev.couponCode && appState.coupons[ev.couponCode] ? appState.coupons[ev.couponCode] : null;
  const amount = Number(paymentDto.amount || (coupon ? coupon.finalPricePen : ev.productPrice) || 5599);
  const opCode = paymentDto.operationCode || `ROO-${method}-${Date.now().toString().slice(-6)}`;
  const orderCode = `ORD-2026-${String(ev.leadId).padStart(4, '0')}-${Math.floor(10 + Math.random() * 89)}`;
  let receiptNumber = `B001-${String(Math.floor(100000 + Math.random() * 899999))}`;

  if (sqlConnected && sqlPool) {
    try {
      const dbRes = await sqlPool
        .request()
        .input('idPersona', sql.BigInt, ev.leadId)
        .input('monto', sql.Decimal(12, 2), amount)
        .input('medioPago', sql.VarChar(30), method === 'CARD' ? 'TARJETA' : method)
        .input('opCode', sql.VarChar(60), opCode)
        .input('numOrden', sql.VarChar(30), orderCode)
        .input('canalRecuperacion', sql.VarChar(40), ev.channel)
        .input('docNum', sql.VarChar(20), ev.leadDocumentNumber || '00000000')
        .input('nombreCliente', sql.NVarChar(150), ev.leadName)
        .query(`
          IF EXISTS (SELECT 1 FROM core.persona WHERE id_persona = @idPersona)
          BEGIN
            UPDATE core.persona SET etapa_actual = 'PAYER', fecha_actualizacion = SYSDATETIME() WHERE id_persona = @idPersona;
            UPDATE leads.lead SET estado_lead = 'CONVERTIDO', fecha_cierre = SYSDATETIME() WHERE id_persona = @idPersona;

            DECLARE @idCot BIGINT = (SELECT TOP 1 id_cotizacion FROM leads.cotizacion WHERE id_persona = @idPersona ORDER BY id_cotizacion DESC);
            IF @idCot IS NULL
            BEGIN
              DECLARE @cotTbl TABLE (id_cotizacion BIGINT);
              INSERT INTO leads.cotizacion
                (id_persona, numero_cotizacion, version_numero, fecha_emision, fecha_vencimiento,
                 subtotal_pen, descuento_pen, total_pen, tipo_cambio_referencial, total_usd,
                 modalidad_pago, pago_inicial_sugerido_pen, numero_cuotas_sugeridas, estado_cotizacion, fecha_aceptacion)
              OUTPUT INSERTED.id_cotizacion INTO @cotTbl
              VALUES
                (@idPersona, CONCAT('COT-RET-', @idPersona, '-', RIGHT(CAST(SYSDATETIME() AS VARCHAR(30)), 4)), 1,
                 SYSDATETIME(), DATEADD(DAY, 7, SYSDATETIME()), @monto, 0.00, @monto, 3.7500, ROUND(@monto/3.75, 2),
                 'CONTADO', @monto, 1, 'ACEPTADA', SYSDATETIME());
              SELECT TOP 1 @idCot = id_cotizacion FROM @cotTbl;
            END
            ELSE
            BEGIN
              UPDATE leads.cotizacion SET estado_cotizacion = 'ACEPTADA', fecha_aceptacion = SYSDATETIME() WHERE id_cotizacion = @idCot;
            END;

            IF NOT EXISTS (SELECT 1 FROM payers.payer WHERE id_persona = @idPersona)
              INSERT INTO payers.payer (id_persona, estado_payer, total_ordenes_activas) VALUES (@idPersona, 'AL_DIA', 1);
            ELSE
              UPDATE payers.payer SET estado_payer = 'AL_DIA', total_ordenes_activas = total_ordenes_activas + 1 WHERE id_persona = @idPersona;

            DECLARE @ordTbl TABLE (id_orden BIGINT);
            INSERT INTO payers.orden_contratacion
              (numero_orden, id_persona, id_cotizacion, tipo_suministro, modalidad_pago,
               total_acordado_pen, monto_pago_inicial_pactado_pen, total_cuotas_pactadas,
               total_pagado_validado_pen, saldo_pendiente_pen, estado_orden,
               fecha_formalizacion, fecha_pago_inicial_confirmado, fecha_activacion_pedido)
            OUTPUT INSERTED.id_orden INTO @ordTbl
            VALUES
              (@numOrden, @idPersona, @idCot, 'IMPORTACION_USA', 'CONTADO',
               @monto, @monto, 1, @monto, 0.00, 'ACTIVADO_EN_IMPORTACION',
               SYSDATETIME(), SYSDATETIME(), SYSDATETIME());
            DECLARE @idOrd BIGINT = (SELECT TOP 1 id_orden FROM @ordTbl);

            DECLARE @pagoTbl TABLE (id_pago BIGINT);
            INSERT INTO payers.pago
              (id_orden, medio_pago, numero_operacion_transaccion, entidad_bancaria, moneda,
               monto_pagado, tipo_cambio_aplicado, fecha_transaccion, estado_pago,
               validado_por_ia, id_agente, usuario_validador, fecha_validacion)
            OUTPUT INSERTED.id_pago INTO @pagoTbl
            VALUES
              (@idOrd, @medioPago, @opCode, 'RooPay Retargeting', 'PEN',
               @monto, 3.7500, SYSDATETIME(), 'VALIDADO', 1, 4, 'AGT_RETARGETING_LP', SYSDATETIME());
            DECLARE @idPago BIGINT = (SELECT TOP 1 id_pago FROM @pagoTbl);

            DECLARE @correlativo INT = CAST(@idPago AS INT) + 50000;
            INSERT INTO payers.comprobante_electronico
              (id_orden, id_pago, tipo_comprobante, serie, numero_correlativo,
               numero_documento_cliente, nombre_razon_social, subtotal_gravado_pen, igv_pen,
               total_comprobante_pen, estado_emision, hash_cpe)
            VALUES
              (@idOrd, @idPago, 'BOLETA', 'B001', @correlativo,
               @docNum, @nombreCliente, ROUND(@monto / 1.18, 2), @monto - ROUND(@monto / 1.18, 2),
               @monto, 'EMITIDO', CONCAT('SHA256-SUNAT-RET-', @idPago));

            INSERT INTO core.historial_etapa
              (id_persona, etapa_anterior, etapa_nueva, motivo_transicion, senal_origen, id_entidad_referencia, tipo_entidad_referencia, registrado_por)
            VALUES
              (@idPersona, 'LEADS', 'PAYER', CONCAT(N'Conversión LEAD -> PAYER vía ', @canalRecuperacion), 'PAGO_RETARGETING', @idPago, 'pago', 'AGT_RETARGETING_LP');

            SELECT CONCAT('B001-', @correlativo) AS comprobante;
          END;
        `);
      if (dbRes.recordset?.[0]?.comprobante) {
        receiptNumber = dbRes.recordset[0].comprobante;
      }
    } catch (sqlErr) {
      console.warn('DML opcional SQL (manteniendo conversión local):', sqlErr.message);
    }
  }

  ev.status = 'CONVERTIDO_PAYER';
  ev.state = 'CONVERTIDO_PAYER';
  ev.convertedAt = new Date().toISOString();
  ev.paymentInfo = {
    paymentMethod: method,
    amount,
    operationCode: opCode,
    receiptNumber,
    orderCode,
    paidAt: new Date().toISOString(),
  };

  if (ev.strategyKey && appState.abStats[ev.strategyKey]) {
    appState.abStats[ev.strategyKey].converted += 1;
  }

  const leadObj = appState.leads.find((l) => Number(l.id) === Number(ev.leadId));
  if (leadObj) leadObj.stage = 'PAYER';

  if (waStatus.state === 'CONNECTED' && ev.leadPhone) {
    const receiptMsg =
      `*PAGO CONFIRMADO — ${ev.sourceStore || appState.config.storeName}*\n\n` +
      `Gracias *${ev.leadFirstName}*. Tu pago por *${fmtMoney(amount)}* (${method}) fue validado.\n` +
      `Comprobante SUNAT: *${receiptNumber}*\n` +
      `Orden: *${orderCode}* (${ev.productName})\n` +
      `Coordinación de entrega en ${appState.config.storeAddress}.`;
    await sendRealWhatsAppMessage(ev.leadPhone, null, receiptMsg);
    ev.conversation.push({ from: 'AGENT', action: 'PAYMENT_RECEIPT', text: receiptMsg, at: new Date().toISOString() });
  }

  saveState();
  return ev;
}

// ----------------------------------------------------------------------------
// 8. ENDPOINTS DE API, TRACKING, SDK Y DIAGNÓSTICO
// ----------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    brand: 'roo | Soluciones Digitales',
    service: 'roo-retargeting-ai',
    whatsappState: waStatus.state,
    smtpMode: mailAccountInfo.mode,
    sqlServerConnected: sqlConnected,
    zeroDdlMode: true,
    activeSessions: activeSessions.size,
  });
});

// Tracking real: Píxel de apertura de correo (1x1 PNG)
app.get('/t/o/:token.png', (req, res) => {
  const token = String(req.params.token || '').trim();
  const ev = appState.events.find((e) => e.recoverToken === token);
  if (ev && !ev.openedAt) {
    ev.openedAt = new Date().toISOString();
    if (ev.status !== 'CONVERTIDO_PAYER') ev.state = 'CORREO_ABIERTO';
    ev.decisionTrace = ev.decisionTrace || [];
    ev.decisionTrace.push(`Lead abrió correo HTML (${new Date(ev.openedAt).toLocaleTimeString('es-PE')})`);
    saveState();
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(TRANSPARENT_PNG);
});

// Tracking real: Clic en enlace de recuperación -> Redirección a tienda anfitriona
app.get('/r/:token', (req, res) => {
  const token = String(req.params.token || '').trim();
  const ev = appState.events.find((e) => e.recoverToken === token);
  if (!ev) {
    return res.redirect(appState.config.storeUrl || `${PUBLIC_AGENT_URL}/demo-shop.html`);
  }
  if (!ev.clickedAt) {
    ev.clickedAt = new Date().toISOString();
    if (ev.status !== 'CONVERTIDO_PAYER') ev.state = 'LINK_CLICKEADO';
    ev.decisionTrace = ev.decisionTrace || [];
    ev.decisionTrace.push(`Lead hizo clic en link mágico (${new Date(ev.clickedAt).toLocaleTimeString('es-PE')})`);
    saveState();
  }
  const couponParam = req.query.coupon || ev.couponCode || '';
  const target = ev.checkoutUrl + (couponParam ? `&coupon=${encodeURIComponent(couponParam)}` : '');
  res.redirect(target);
});

// Visor HTML local de correos generados (resuelve cid: a URL HTTP real para iframe)
app.get('/api/retargeting/:id/email-preview', (req, res) => {
  const ev = appState.events.find((e) => Number(e.id) === Number(req.params.id) || e.recoverToken === req.params.id);
  if (!ev) return res.status(404).send('<h3>Evento no encontrado</h3>');
  const product = findProduct(ev.productSlug || ev.productName);
  const resolvedImg = ev.productImage || product.image || product.emailImageUrl;

  if (ev.emailHtml) {
    const htmlWithHttpImg = ev.emailHtml.replace(/src=["']cid:roo-product["']/g, `src="${resolvedImg}"`);
    return res.type('html').send(htmlWithHttpImg);
  }

  const html = buildRealAbandonedEmailHtml({
    lead: { firstName: ev.leadFirstName || 'Cliente', email: ev.leadEmail },
    product,
    customImgSrc: resolvedImg,
    clickUrl: ev.trackingClickUrl || ev.checkoutUrl,
    pixelUrl: null,
    strategyLabel: ev.strategyLabel,
    storeNameOverride: ev.sourceStore || appState.config.storeName,
  });
  res.type('html').send(html);
});

app.get('/api/status', async (req, res) => {
  const localLeadsCount = appState.leads.filter((l) => l.stage !== 'PAYER').length;
  const localPayersCount = appState.leads.filter((l) => l.stage === 'PAYER').length;
  const dbFunnel = { totalLeadsInDb: localLeadsCount, totalPayersInDb: localPayersCount };

  // Agregación local de atribución por rango y canal
  const summaryMap = new Map();
  for (const ev of appState.events) {
    const key = `${ev.tier}__${ev.channel}`;
    const cur = summaryMap.get(key) || {
      tier: ev.tier,
      channel: ev.channel,
      totalAbandonments: 0,
      openedCount: 0,
      clickedCount: 0,
      convertedCount: 0,
      totalSoldPen: 0,
    };
    cur.totalAbandonments += 1;
    if (ev.openedAt) cur.openedCount += 1;
    if (ev.clickedAt) cur.clickedCount += 1;
    if (ev.status === 'CONVERTIDO_PAYER') {
      cur.convertedCount += 1;
      cur.totalSoldPen += Number(ev.paymentInfo?.amount || ev.productPrice || 0);
    }
    summaryMap.set(key, cur);
  }

  const totalEvents = appState.events.length;
  const converted = appState.events.filter((e) => e.status === 'CONVERTIDO_PAYER').length;
  const opened = appState.events.filter((e) => Boolean(e.openedAt)).length;
  const clicked = appState.events.filter((e) => Boolean(e.clickedAt)).length;
  const recoveredRevenue = appState.events
    .filter((e) => e.status === 'CONVERTIDO_PAYER')
    .reduce((acc, e) => acc + Number(e.paymentInfo?.amount || e.productPrice || 0), 0);

  const sessionsList = Array.from(activeSessions.values()).map((s) => {
    const product = findProduct(s.productSlug || s.productName);
    const analysis = calculateIntentAnalysis(s.secondsViewed, s.interactions, product, { phone: s.phone, email: s.email });
    return { ...s, analysis };
  });

  res.json({
    ok: true,
    whatsapp: waStatus,
    smtp: mailAccountInfo,
    sqlServerConnected: sqlConnected,
    config: {
      ...appState.config,
      smtpPassConfigured: Boolean(runtimeSmtpPass || process.env.SMTP_PASS),
      geminiConfigured: Boolean(runtimeGeminiKey),
    },
    catalog: [...CATALOG, ...(appState.customProducts || [])],
    leads: appState.leads,
    activeSessions: sessionsList,
    events: appState.events,
    abStats: appState.abStats,
    dbAnalytics: {
      byChannel: Array.from(summaryMap.values()),
      ...dbFunnel,
    },
    kpis: {
      totalAbandonments: totalEvents,
      openedCount: opened,
      clickedCount: clicked,
      convertedToPayer: converted,
      conversionRate: totalEvents > 0 ? Math.round((converted / totalEvents) * 100) : 0,
      recoveredRevenuePen: recoveredRevenue,
      byEmail: appState.events.filter((e) => e.channel === 'CORREO_HTML').length,
      byWhatsapp: appState.events.filter((e) => e.channel === 'WHATSAPP_DIRECTO').length,
      byAdvisor: appState.events.filter((e) => e.channel === 'ALERTA_ASESOR_LLAMADA').length,
      pendingAdvisorCalls: appState.events.filter((e) => e.channel === 'ALERTA_ASESOR_LLAMADA' && !e.advisorClaimedAt && e.status !== 'CONVERTIDO_PAYER').length,
    },
  });
});

// CRUD Persistente de LEADS / Números Guardados
app.get('/api/leads', (req, res) => {
  res.json({ ok: true, leads: appState.leads });
});

app.post('/api/leads', (req, res) => {
  const b = req.body || {};
  const cleanPhone = normalizePhoneDigits(b.phone);
  const cleanEmail = String(b.email || '').trim();
  if (!cleanPhone && !cleanEmail) {
    return res.status(400).json({ ok: false, error: 'Ingresa al menos un teléfono WhatsApp o correo válido.' });
  }
  const saved = upsertLeadContact({
    firstName: b.firstName || 'Lead',
    lastName: b.lastName || '',
    phone: b.phone,
    email: b.email,
    documentNumber: b.documentNumber,
    district: b.district,
    stage: b.stage || 'LEAD',
    priority: b.priority || 'ALTA',
    notes: b.notes || 'Guardado desde Torre de Control',
  });
  res.json({ ok: true, lead: saved });
});

app.put('/api/leads/:id', (req, res) => {
  const lead = appState.leads.find((l) => Number(l.id) === Number(req.params.id));
  if (!lead) return res.status(404).json({ ok: false, error: 'Contacto no encontrado' });
  const b = req.body || {};
  if (b.firstName !== undefined) lead.firstName = String(b.firstName).trim();
  if (b.lastName !== undefined) lead.lastName = String(b.lastName).trim();
  if (b.phone !== undefined) lead.phone = formatDisplayPhone(b.phone);
  if (b.email !== undefined) lead.email = String(b.email).trim().toLowerCase();
  if (b.district !== undefined) lead.district = String(b.district).trim();
  if (b.stage !== undefined) lead.stage = b.stage;
  if (b.notes !== undefined) lead.notes = String(b.notes).trim();
  lead.updatedAt = new Date().toISOString();
  saveState();
  res.json({ ok: true, lead });
});

app.delete('/api/leads/:id', (req, res) => {
  const before = appState.leads.length;
  appState.leads = appState.leads.filter((l) => Number(l.id) !== Number(req.params.id));
  if (appState.leads.length === before) return res.status(404).json({ ok: false, error: 'Contacto no encontrado' });
  saveState();
  res.json({ ok: true });
});

// Telemetría en vivo desde Storefront o SDK Universal
app.post('/api/telemetry/heartbeat', (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      body = {};
    }
  }
  const sessionId = body.sessionId || `sess-${Date.now()}`;
  const prev = activeSessions.get(sessionId);

  const phone = (body.phone || prev?.phone || '').trim();
  const email = (body.email || prev?.email || '').trim();
  const leadName = (body.leadName || prev?.leadName || 'Visitante en tienda').trim();

  // Persistir contacto inmediatamente en directorio si ya ingresó teléfono/correo real
  let matchedLeadId = body.leadId || prev?.leadId || 101;
  if (phone || email) {
    const saved = upsertLeadContact({
      id: matchedLeadId,
      leadName,
      firstName: body.firstName,
      lastName: body.lastName,
      phone,
      email,
      district: body.district,
      documentNumber: body.documentNumber,
      notes: body.sourceStore ? `Captado en ${body.sourceStore}` : 'Telemetría tienda en vivo',
    });
    if (saved) matchedLeadId = saved.id;
  }

  activeSessions.set(sessionId, {
    sessionId,
    leadId: matchedLeadId,
    leadName,
    phone: formatDisplayPhone(phone),
    email,
    sourceStore: body.sourceStore || prev?.sourceStore || appState.config.storeName,
    returnUrl: body.returnUrl || prev?.returnUrl || appState.config.storeUrl,
    productName: body.productName || 'iPhone 18 Pro Max',
    productSlug: body.productSlug || 'iphone-18-pro-max',
    secondsViewed: Number(body.secondsViewed || 0),
    cartItems: Array.isArray(body.cartItems) ? body.cartItems : prev?.cartItems || [],
    cartTotal: Number(body.cartTotal || prev?.cartTotal || 0),
    focusedProduct: body.focusedProduct || prev?.focusedProduct || null,
    comparedModels: Array.isArray(body.comparedModels) ? body.comparedModels : prev?.comparedModels || [],
    customerLoggedIn: Boolean(body.customerLoggedIn ?? prev?.customerLoggedIn),
    interactions: {
      ...(prev?.interactions || {}),
      ...(body.interactions || {}),
      cartCount: Array.isArray(body.cartItems) ? body.cartItems.length : prev?.cartItems?.length || 0,
      comparedCount: Array.isArray(body.comparedModels) ? body.comparedModels.length : prev?.comparedModels?.length || 0,
    },
    purchased: Boolean(body.purchased || prev?.purchased),
    updatedAt: new Date().toISOString(),
  });

  if (body.purchased) {
    activeSessions.delete(sessionId);
    processedSessionIds.add(sessionId);
  }

  res.json({ ok: true, leadId: matchedLeadId });
});

app.post('/api/retargeting/abandon', async (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (_) {
        body = {};
      }
    }
    if (body.sessionId) {
      activeSessions.delete(body.sessionId);
      if (!body.bypassCooldown && processedSessionIds.has(body.sessionId)) {
        return res.json({ ok: true, deduplicated: true });
      }
      processedSessionIds.add(body.sessionId);
    }

    const result = await processRealAbandonment(body || {});
    if (result.skippedCooldown) {
      return res.json({ ok: true, skipped: true, reason: result.reason });
    }
    res.json({ ok: true, event: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Link Mágico: consulta reserva
app.get('/api/retargeting/recover/:token', (req, res) => {
  const token = String(req.params.token || '').trim();
  const ev = appState.events.find((e) => e.recoverToken === token || String(e.id) === token);
  if (!ev) return res.status(404).json({ ok: false, error: 'Enlace de reserva no encontrado o expirado.' });
  const coupon = ev.couponCode && appState.coupons[ev.couponCode] ? appState.coupons[ev.couponCode] : null;
  res.json({ ok: true, recovery: { ...ev, coupon } });
});

// Link Mágico: completar pago -> PAYER
app.post('/api/retargeting/recover/:token/complete', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    const ev = appState.events.find((e) => e.recoverToken === token || String(e.id) === token);
    if (!ev) return res.status(404).json({ ok: false, error: 'Token de recuperación no encontrado.' });
    const updated = await convertLeadToPayerInDb(ev, req.body || {});
    res.json({ ok: true, event: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Conversión directa desde Torre de Control
app.post('/api/retargeting/:id/convert', async (req, res) => {
  try {
    const ev = await convertLeadToPayerInDb(req.params.id, req.body || {});
    res.json({ ok: true, event: ev });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Respuesta manual del Asesor o Simulación Cliente NLU en el hilo WhatsApp
app.post('/api/retargeting/:id/reply', async (req, res) => {
  try {
    const ev = appState.events.find((e) => Number(e.id) === Number(req.params.id));
    if (!ev) return res.status(404).json({ ok: false, error: 'Evento no encontrado' });
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ ok: false, error: 'Mensaje vacío' });
    if (!Array.isArray(ev.conversation)) ev.conversation = [];

    if (req.body?.simulateClient === true) {
      ev.conversation.push({ from: 'CLIENT', text, at: new Date().toISOString() });
      const smart = await generateSmartReply(text, ev);
      ev.conversation.push({ from: 'AGENT', action: smart.action, intent: smart.intent, text: smart.reply, at: new Date().toISOString() });
      if (ev.status !== 'CONVERTIDO_PAYER' && !ev.clientOptOut && ev.state === 'TOQUE_1_ENVIADO') {
        ev.state = 'EN_CONVERSACION';
      }
      saveState();
      return res.json({ ok: true, simulatedNlu: smart, event: ev, conversation: ev.conversation });
    }

    const target = ev.waLid ? `${ev.waLid}@lid` : formatPhoneToJid(ev.leadPhone);
    let sentRes = { sent: false, reason: 'WhatsApp desconectado' };
    if (waSock && waStatus.state === 'CONNECTED' && target) {
      await waSock.sendMessage(target, { text });
      sentRes = { sent: true, jid: target };
    }
    ev.conversation.push({ from: 'AGENT', action: 'MANUAL_ADVISOR_REPLY', text, at: new Date().toISOString() });
    ev.state = 'EN_CONVERSACION';
    saveState();
    res.json({ ok: sentRes.sent, delivery: sentRes, conversation: ev.conversation });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/retargeting/:id/advisor-claim', (req, res) => {
  const ev = appState.events.find((e) => Number(e.id) === Number(req.params.id));
  if (!ev) return res.status(404).json({ ok: false, error: 'Evento no encontrado' });
  const now = new Date();
  ev.advisorClaimedAt = now.toISOString();
  ev.slaSeconds = Math.max(1, Math.round((now.getTime() - new Date(ev.createdAt).getTime()) / 1000));
  ev.state = 'ESCALADO_ASESOR';
  saveState();
  res.json({ ok: true, event: ev });
});

// Diagnósticos directos de canales reales
app.post('/api/test/email', async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || appState.config.advisorEmail || '').trim();
  const product = findProduct(b.productSlug || b.productId);
  const lead = upsertLeadContact({ firstName: b.name || 'Prueba', phone: b.phone || '', email }) || { firstName: 'Prueba', email };
  const result = await sendRecoveryEmail({
    lead,
    product,
    clickUrl: `${PUBLIC_AGENT_URL}/r/TEST`,
    pixelUrl: null,
    strategyLabel: 'Verificación Directa SMTP',
    subjectOverride: `Prueba SMTP - ${appState.config.storeName}`,
  });
  res.json({ ok: result.delivery.sent, delivery: result.delivery, smtp: mailAccountInfo });
});

app.post('/api/test/whatsapp', async (req, res) => {
  const b = req.body || {};
  const phone = String(b.phone || appState.config.advisorPhone || '').trim();
  const product = findProduct(b.productSlug || b.productId);
  if (phone) upsertLeadContact({ firstName: b.name || 'Prueba', phone, email: b.email || '' });
  const text = `*${appState.config.storeName} · Prueba Oficial*\nCanal WhatsApp operativo para *${product.name}* (${fmtMoney(product.price)}).`;
  const waMedia = product.localMediaPath && fs.existsSync(product.localMediaPath) ? product.localMediaPath : null;
  const delivery = await sendRealWhatsAppMessage(phone, waMedia, text);
  res.json({ ok: delivery.sent, delivery });
});

// Configuración general (Marca, SMTP, Guardrails, Gemini opcional)
app.post('/api/config', async (req, res) => {
  try {
    const b = req.body || {};
    if (b.storeName !== undefined) appState.config.storeName = b.storeName.trim() || 'Tienda Demo · roo';
    if (b.storeAddress !== undefined) appState.config.storeAddress = b.storeAddress.trim();
    if (b.storeUrl !== undefined) {
      appState.config.storeUrl = b.storeUrl.trim();
    }
    if (b.advisorName !== undefined) appState.config.advisorName = b.advisorName.trim();
    if (b.advisorPhone !== undefined) appState.config.advisorPhone = formatDisplayPhone(b.advisorPhone);
    if (b.advisorEmail !== undefined) appState.config.advisorEmail = b.advisorEmail.trim();
    if (b.smtpHost !== undefined) appState.config.smtpHost = b.smtpHost.trim() || 'smtp.gmail.com';
    if (b.smtpPort !== undefined) appState.config.smtpPort = Number(b.smtpPort || 465);
    if (b.smtpUser !== undefined) appState.config.smtpUser = b.smtpUser.trim();
    if (b.smtpPass !== undefined && b.smtpPass.trim() && b.smtpPass !== '********') {
      runtimeSmtpPass = b.smtpPass.trim();
    }
    if (b.geminiApiKey !== undefined && b.geminiApiKey.trim() && b.geminiApiKey !== '********') {
      runtimeGeminiKey = b.geminiApiKey.trim();
    }
    if (b.emailMaxSeconds !== undefined) appState.config.emailMaxSeconds = Math.max(15, Number(b.emailMaxSeconds));
    if (b.whatsappMaxSeconds !== undefined) appState.config.whatsappMaxSeconds = Math.max(30, Number(b.whatsappMaxSeconds));
    if (b.abandonTimeoutSeconds !== undefined) appState.config.abandonTimeoutSeconds = Math.max(10, Number(b.abandonTimeoutSeconds));
    if (b.touch2DelaySeconds !== undefined) appState.config.touch2DelaySeconds = Math.max(30, Number(b.touch2DelaySeconds));
    if (b.maxDiscountPercent !== undefined) appState.config.maxDiscountPercent = Math.max(1, Math.min(20, Number(b.maxDiscountPercent)));
    if (b.cooldownMinutes !== undefined) appState.config.cooldownMinutes = Math.max(0, Number(b.cooldownMinutes));
    if (b.quietHoursEnabled !== undefined) appState.config.quietHoursEnabled = Boolean(b.quietHoursEnabled);

    saveState();
    await initMailer();
    res.json({ ok: true, smtp: mailAccountInfo, config: appState.config });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Alta rápida de producto custom en catálogo universal (sin tocar SQL)
app.post('/api/catalog/custom', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.price) return res.status(400).json({ ok: false, error: 'Nombre y precio obligatorios' });
  const price = Number(b.price);
  const slug = String(b.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const item = {
    id: 900 + (appState.customProducts?.length || 0) + 1,
    slug,
    sku: `UNIV-${Date.now().toString().slice(-4)}`,
    name: b.name.trim(),
    shortName: b.name.trim(),
    category: b.category || 'iPhone',
    color: b.color || 'Estándar',
    capacity: b.capacity || 'Base',
    stock: Number(b.stock || 5),
    price,
    originalPrice: Math.round(price * 1.1),
    installment3: Number((price / 3).toFixed(2)),
    image: CATEGORY_IMAGE_MAP[b.category] || CATEGORY_IMAGE_MAP.iPhone,
    emailImageUrl: CATEGORY_IMAGE_MAP[b.category] || CATEGORY_IMAGE_MAP.iPhone,
    localMediaPath: null,
  };
  appState.customProducts = [item, ...(appState.customProducts || [])].slice(0, 30);
  saveState();
  res.json({ ok: true, product: item });
});

app.post('/api/whatsapp/reset', async (req, res) => {
  try {
    if (waSock) {
      try {
        await waSock.logout();
      } catch (_) {}
    }
    fs.rmSync(WA_AUTH_DIR, { recursive: true, force: true });
    waStatus = { state: 'DISCONNECTED', qrDataUrl: null, connectedPhone: null, connectedName: null, lastError: null };
    initWhatsAppClient();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Iniciar sistema: abre HTTP primero (<200ms) y conecta canales en segundo plano
(async () => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('============================================================================');
    console.log(`🚀 ROO RETARGETING AI (roo | Soluciones Digitales) EN: http://localhost:${PORT}`);
    console.log(`   - SDK Universal: ${PUBLIC_AGENT_URL}/sdk/roo-agent.js`);
    console.log(`   - Demo Sandbox Externa: ${PUBLIC_AGENT_URL}/demo-shop.html`);
    console.log(`   - Persistencia: 100% Local Atómica (${DATA_FILE})`);
    console.log('============================================================================');
  });

  startAbandonmentSweeper();
  await initMailer();
  syncCatalogFromStorefront().catch(() => {});
  setInterval(() => {
    syncCatalogFromStorefront().catch(() => {});
  }, 60000);
  initSqlConnection().catch(() => {});
  initWhatsAppClient().catch(() => {});
})();
