/**
 * ============================================================================
 * ROO RETARGETING AI — SDK WEB UNIVERSAL (v2.0)
 * Producto independiente de roo | Soluciones Digitales ("Tecnología con Propósito")
 * Embebible en cualquier tienda HTML, React, Vue, Shopify o WooCommerce:
 *   <script src="http://localhost:4000/sdk/roo-agent.js" data-store="Mi Tienda"></script>
 * ============================================================================
 */
(function (global, doc) {
  'use strict';

  var currentScript = doc.currentScript;
  var scriptOrigin = '';
  try {
    if (currentScript && currentScript.src) {
      scriptOrigin = new URL(currentScript.src, global.location.href).origin;
    }
  } catch (_) {}

  var cfg = Object.assign(
    {
      agentUrl:
        (currentScript && currentScript.getAttribute('data-agent-url')) ||
        scriptOrigin ||
        'http://localhost:4000',
      storeName:
        (currentScript && currentScript.getAttribute('data-store')) ||
        (global.RooRetargetingConfig && global.RooRetargetingConfig.storeName) ||
        doc.title ||
        'Tienda Conectada',
      minDwellSeconds: Number(
        (currentScript && currentScript.getAttribute('data-min-dwell')) || 12
      ),
      heartbeatIntervalMs: 5000,
    },
    global.RooRetargetingConfig || {}
  );

  cfg.agentUrl = String(cfg.agentUrl || 'http://localhost:4000').replace(/\/+$/, '');

  var SESSION_STORAGE_KEY = 'roo_sdk_session_id';
  var LEAD_STORAGE_KEY = 'roo_sdk_lead_profile';

  function getSessionId() {
    try {
      var existing = global.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (existing) return existing;
      var created = 'roo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      global.sessionStorage.setItem(SESSION_STORAGE_KEY, created);
      return created;
    } catch (_) {
      return 'roo-' + Date.now();
    }
  }

  function loadStoredLead() {
    try {
      var raw = global.localStorage.getItem(LEAD_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function persistLead(leadObj) {
    try {
      global.localStorage.setItem(LEAD_STORAGE_KEY, JSON.stringify(leadObj || {}));
    } catch (_) {}
  }

  var state = {
    sessionId: getSessionId(),
    startedAt: Date.now(),
    secondsViewed: 0,
    purchased: false,
    abandonSent: false,
    recoveryToken: null,
    recoveryCoupon: null,
    lead: Object.assign(
      { firstName: '', lastName: '', leadName: '', email: '', phone: '', district: '' },
      loadStoredLead(),
      cfg.lead || {}
    ),
    focusedProduct: cfg.product || null,
    cartItems: Array.isArray(cfg.cartItems) ? cfg.cartItems : [],
    comparedModels: [],
    interactions: {
      clicks: 0,
      comparedCount: 0,
      cartCount: 0,
      startedCheckout: false,
      quoteOpened: false,
      chatOpened: false,
    },
  };

  function buildPayload(extra) {
    var leadName =
      state.lead.leadName ||
      [state.lead.firstName, state.lead.lastName].filter(Boolean).join(' ').trim() ||
      'Visitante en tienda';
    var cartTotal = state.cartItems.reduce(function (acc, item) {
      return acc + Number(item.price || item.pricePen || 0) * Number(item.qty || 1);
    }, 0);
    var p = state.focusedProduct || state.cartItems[0] || {};
    return Object.assign(
      {
        sessionId: state.sessionId,
        sourceStore: cfg.storeName,
        returnUrl: global.location.href.split('?')[0],
        leadName: leadName,
        firstName: state.lead.firstName || leadName.split(' ')[0] || '',
        lastName: state.lead.lastName || leadName.split(' ').slice(1).join(' ') || '',
        email: state.lead.email || '',
        phone: state.lead.phone || '',
        district: state.lead.district || '',
        productId: p.id || 1,
        productSlug: p.slug || '',
        productName: p.name || 'Producto destacado',
        cartItems: state.cartItems,
        cartTotal: cartTotal || Number(p.price || p.pricePen || 0),
        focusedProduct: state.focusedProduct,
        comparedModels: state.comparedModels,
        secondsViewed: state.secondsViewed,
        purchased: state.purchased,
        interactions: Object.assign({}, state.interactions, {
          cartCount: state.cartItems.length,
          comparedCount: state.comparedModels.length,
        }),
      },
      extra || {}
    );
  }

  function postJson(path, payload, preferBeacon) {
    var url = cfg.agentUrl + path;
    var body = JSON.stringify(payload);
    if (preferBeacon && doc && global.navigator && typeof global.navigator.sendBeacon === 'function') {
      try {
        var blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
        if (global.navigator.sendBeacon(url, blob)) return Promise.resolve({ ok: true, beacon: true });
      } catch (_) {}
    }
    return global
      .fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: Boolean(preferBeacon),
      })
      .then(function (r) {
        return r.json();
      })
      .catch(function (err) {
        return { ok: false, error: err && err.message };
      });
  }

  function sendHeartbeat() {
    if (state.purchased) return Promise.resolve({ ok: true, skipped: true });
    return postJson('/api/telemetry/heartbeat', buildPayload(), false);
  }

  function triggerAbandonmentNow(reason, extra) {
    if (state.purchased || state.abandonSent) return Promise.resolve({ ok: false, skipped: true });
    if (!state.lead.phone && !state.lead.email && !state.cartItems.length && !state.focusedProduct) {
      return Promise.resolve({ ok: false, skipped: 'sin_contexto' });
    }
    state.abandonSent = true;
    return postJson(
      '/api/retargeting/abandon',
      buildPayload(
        Object.assign(
          {
            exitReason: reason || 'SDK_ABANDONO_WEB',
            bypassCooldown: Boolean(extra && extra.bypassCooldown),
          },
          extra || {}
        )
      ),
      Boolean(extra && extra.beacon)
    );
  }

  function syncInputsFromDom(el) {
    if (!el || !el.tagName) return;
    var tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return;
    var type = (el.getAttribute('type') || '').toLowerCase();
    var hint = [el.name, el.id, el.placeholder, el.getAttribute('aria-label')].filter(Boolean).join(' ').toLowerCase();
    var val = String(el.value || '').trim();
    if (!val) return;

    var changed = false;
    if (type === 'email' || /email|correo|mail/.test(hint)) {
      if (val.indexOf('@') !== -1 && state.lead.email !== val) {
        state.lead.email = val;
        changed = true;
      }
    } else if (type === 'tel' || /phone|tel|cel|whatsapp|movil|móvil/.test(hint)) {
      var digits = val.replace(/\D+/g, '');
      if (digits.length >= 6 && state.lead.phone !== val) {
        state.lead.phone = val;
        changed = true;
      }
    } else if (/first.?name|nombre/.test(hint) && !/product|empresa|store/.test(hint)) {
      state.lead.firstName = val.split(' ')[0];
      state.lead.leadName = val;
      changed = true;
    }

    if (changed) {
      persistLead(state.lead);
      sendHeartbeat();
    }
  }

  // Detectar ?recover=TOKEN y ?coupon=CODE cuando regresa del link mágico
  function checkMagicRecoveryUrl() {
    try {
      var params = new URLSearchParams(global.location.search);
      var token = params.get('recover');
      var coupon = params.get('coupon');
      if (!token) return;
      state.recoveryToken = token;
      state.recoveryCoupon = coupon;
      global
        .fetch(cfg.agentUrl + '/api/retargeting/recover/' + encodeURIComponent(token))
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (data && data.ok && typeof cfg.onRecover === 'function') {
            cfg.onRecover(data.recovery);
          }
          global.dispatchEvent(new CustomEvent('roo:recover', { detail: data && data.recovery }));
        })
        .catch(function () {});
    } catch (_) {}
  }

  // Temporizador activo + Heartbeat cada 5s
  var dwellTimer = global.setInterval(function () {
    if (!doc.hidden && !state.purchased) {
      state.secondsViewed += 1;
    }
  }, 1000);

  var heartbeatTimer = global.setInterval(function () {
    if (!doc.hidden && !state.purchased && (state.lead.phone || state.lead.email || state.focusedProduct || state.cartItems.length)) {
      sendHeartbeat();
    }
  }, cfg.heartbeatIntervalMs);

  // Listeners universales en DOM
  doc.addEventListener(
    'click',
    function (e) {
      state.interactions.clicks += 1;
      var target = e.target && e.target.closest ? e.target.closest('[data-roo-product],[data-product],[data-roo-checkout],[data-roo-cart-add],[data-roo-compare]') : null;
      if (!target) return;

      if (target.hasAttribute('data-roo-product') || target.hasAttribute('data-product')) {
        state.focusedProduct = {
          slug: target.getAttribute('data-roo-slug') || target.getAttribute('data-roo-product') || target.getAttribute('data-product'),
          name: target.getAttribute('data-roo-name') || target.textContent.trim().slice(0, 80),
          price: Number(target.getAttribute('data-roo-price') || 0),
        };
      }
      if (target.hasAttribute('data-roo-cart-add')) {
        var slug = target.getAttribute('data-roo-cart-add') || (state.focusedProduct && state.focusedProduct.slug) || '';
        state.cartItems.push({
          slug: slug,
          name: target.getAttribute('data-roo-name') || (state.focusedProduct && state.focusedProduct.name) || slug,
          price: Number(target.getAttribute('data-roo-price') || (state.focusedProduct && state.focusedProduct.price) || 0),
          qty: 1,
        });
      }
      if (target.hasAttribute('data-roo-compare')) {
        var cSlug = target.getAttribute('data-roo-compare');
        if (cSlug && state.comparedModels.indexOf(cSlug) === -1) state.comparedModels.push(cSlug);
      }
      if (target.hasAttribute('data-roo-checkout')) {
        state.interactions.startedCheckout = true;
      }
      sendHeartbeat();
    },
    true
  );

  var inputTimer = null;
  doc.addEventListener(
    'input',
    function (e) {
      global.clearTimeout(inputTimer);
      inputTimer = global.setTimeout(function () {
        syncInputsFromDom(e.target);
      }, 450);
    },
    true
  );
  doc.addEventListener('blur', function (e) { syncInputsFromDom(e.target); }, true);

  doc.addEventListener('visibilitychange', function () {
    if (doc.visibilityState === 'hidden' && !state.purchased && !state.abandonSent) {
      if (state.secondsViewed >= cfg.minDwellSeconds && (state.lead.phone || state.lead.email)) {
        triggerAbandonmentNow('CIERRE_O_CAMBIO_PESTANA_SDK', { beacon: true });
      }
    }
  });

  global.addEventListener('pagehide', function () {
    if (!state.purchased && !state.abandonSent && state.secondsViewed >= cfg.minDwellSeconds && (state.lead.phone || state.lead.email)) {
      triggerAbandonmentNow('SALIDA_PAGINA_SDK', { beacon: true });
    }
  });

  checkMagicRecoveryUrl();

  var publicApi = {
    version: '2.0.0',
    brand: 'roo | Soluciones Digitales',
    getConfig: function () { return cfg; },
    getSnapshot: function () { return buildPayload(); },
    setLead: function (leadObj) {
      state.lead = Object.assign({}, state.lead, leadObj || {});
      persistLead(state.lead);
      return sendHeartbeat();
    },
    setProduct: function (prodObj) {
      state.focusedProduct = prodObj || null;
      return sendHeartbeat();
    },
    setSecondsViewed: function (secs) {
      state.secondsViewed = Math.max(0, Number(secs || 0));
    },
    setCart: function (items) {
      state.cartItems = Array.isArray(items) ? items : [];
      state.abandonSent = false;
      return sendHeartbeat();
    },
    addToCart: function (item) {
      if (item) state.cartItems.push(item);
      state.abandonSent = false;
      return sendHeartbeat();
    },
    markCheckoutStarted: function () {
      state.interactions.startedCheckout = true;
      state.abandonSent = false;
      return sendHeartbeat();
    },
    triggerAbandonmentNow: function (reason, extra) {
      state.abandonSent = false;
      return triggerAbandonmentNow(reason, extra);
    },
    markCompletedPurchase: function (paymentDto) {
      state.purchased = true;
      global.clearInterval(dwellTimer);
      global.clearInterval(heartbeatTimer);
      if (state.recoveryToken) {
        return postJson('/api/retargeting/recover/' + encodeURIComponent(state.recoveryToken) + '/complete', paymentDto || {}, false);
      }
      return sendHeartbeat();
    },
    resetSession: function () {
      state.purchased = false;
      state.abandonSent = false;
      state.secondsViewed = 0;
    },
  };

  global.RooAgent = publicApi;
})(window, document);
