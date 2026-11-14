/* ============================================================================
 * ROO RETARGETING AI — CONTROL TOWER FRONTEND (roo | Soluciones Digitales)
 * ============================================================================ */
let latestStatus = null;
let activeChatEventId = null;
const QUICK_TEST_LS_KEY = 'roo_quick_test_form';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(n) {
  return 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function showToast(msg, type = 'info') {
  const el = document.getElementById('toastBanner');
  el.textContent = msg;
  el.className = `toast ${type === 'ok' ? 'ok' : type === 'err' ? 'err' : ''}`;
  el.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.add('hidden'), 5500);
}

// ---------------------------------------------------------------------------
// 1. NAVEGACIÓN POR PESTAÑAS
// ---------------------------------------------------------------------------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${target}`));
  });
});

// ---------------------------------------------------------------------------
// 2. POLLING PRINCIPAL (/api/status)
// ---------------------------------------------------------------------------
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (!data || !data.ok) return;
    latestStatus = data;
    renderHeaderPills(data);
    renderKpis(data);
    renderLiveSessions(data.activeSessions || []);
    renderAdvisorQueue(data.events || []);
    renderAbStats(data.abStats || {});
    renderLeadsTable(data.leads || []);
    renderEventsFeed(data.events || []);
    syncDropdownsAndConfig(data);

    if (activeChatEventId) {
      const openEv = (data.events || []).find((e) => Number(e.id) === Number(activeChatEventId));
      if (openEv) renderChatMessages(openEv);
    }
  } catch (err) {
    // Silencioso en reinicio temporal
  }
}

function renderHeaderPills(data) {
  const wa = data.whatsapp || {};
  const waPill = document.getElementById('pillWhatsapp');
  if (wa.state === 'CONNECTED') {
    waPill.className = 'status-pill ok';
    waPill.textContent = `WhatsApp: +${wa.connectedPhone || 'Conectado'}`;
  } else if (wa.state === 'QR_READY') {
    waPill.className = 'status-pill warn';
    waPill.textContent = 'WhatsApp: Esperando QR';
  } else {
    waPill.className = 'status-pill danger';
    waPill.textContent = `WhatsApp: ${wa.state || 'Desconectado'}`;
  }

  const smtp = data.smtp || {};
  const smtpPill = document.getElementById('pillSmtp');
  if (smtp.mode === 'GMAIL_REAL_SMTP') {
    smtpPill.className = 'status-pill ok';
    smtpPill.textContent = `SMTP: Gmail Real (${smtp.user || ''})`;
  } else if (smtp.mode === 'ETHEREAL_SMTP_FALLBACK') {
    smtpPill.className = 'status-pill warn';
    smtpPill.textContent = 'SMTP: Ethereal Sandbox';
  } else {
    smtpPill.className = 'status-pill danger';
    smtpPill.textContent = `SMTP: ${smtp.mode || 'Error'}`;
  }

  const sqlPill = document.getElementById('pillSql');
  if (data.sqlServerConnected) {
    sqlPill.className = 'status-pill ok';
    sqlPill.textContent = 'SQL DML: Activo (Zero-DDL)';
  } else {
    sqlPill.className = 'status-pill neutral';
    sqlPill.textContent = 'SQL DML: Autónomo Local';
  }
}

function renderKpis(data) {
  const k = data.kpis || {};
  const funnel = data.dbAnalytics || {};
  document.getElementById('kpiActiveSessions').textContent = (data.activeSessions || []).length;
  document.getElementById('kpiActiveStoreHint').textContent = `Tienda activa: ${data.config?.storeName || 'Tienda Demo · roo'}`;
  document.getElementById('kpiTotalEvents').textContent = k.totalAbandonments || 0;
  document.getElementById('kpiChannelMix').textContent = `${k.byEmail || 0} Email · ${k.byWhatsapp || 0} WA · ${k.byAdvisor || 0} Asesor`;
  document.getElementById('kpiOpensClicks').textContent = `${k.openedCount || 0} / ${k.clickedCount || 0}`;
  document.getElementById('kpiConverted').textContent = k.convertedToPayer || 0;
  document.getElementById('kpiConversionRate').textContent = `${k.conversionRate || 0}% tasa de recuperación`;
  document.getElementById('kpiRevenue').textContent = fmtMoney(k.recoveredRevenuePen || 0);
  document.getElementById('kpiFunnelCounts').textContent = `${funnel.totalLeadsInDb || 0} LEADS · ${funnel.totalPayersInDb || 0} PAYERS`;
}

function renderLiveSessions(sessions) {
  const box = document.getElementById('liveSessionsList');
  if (!sessions.length) {
    box.innerHTML = '<div class="empty-box">No hay sesiones activas en este momento. Abre <a href="/demo-shop.html" target="_blank">Tienda Demo SDK</a> para probar en vivo.</div>';
    return;
  }
  box.innerHTML = sessions.map((s) => {
    const prob = s.analysis?.probability ?? 0;
    const ch = s.analysis?.channel || 'CORREO_HTML';
    return `
      <div class="session-item">
        <div>
          <div><strong>${esc(s.leadName)}</strong> <span class="status-pill neutral">${esc(s.sourceStore || 'Tienda SDK')}</span></div>
          <div class="muted-sm">${esc(s.productName)} · <strong>${s.secondsViewed}s</strong> en página · Score: <strong>${prob}%</strong> (${esc(ch)})</div>
          <div class="muted-sm">${esc(s.phone || 'Sin teléfono')} · ${esc(s.email || 'Sin email')}</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="forceRecoverSession('${esc(s.sessionId)}')">Forzar Recuperación</button>
      </div>
    `;
  }).join('');
}

window.forceRecoverSession = async function (sessionId) {
  const s = (latestStatus?.activeSessions || []).find((x) => x.sessionId === sessionId);
  if (!s) return;
  const res = await fetch('/api/retargeting/abandon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...s, exitReason: 'DISPARO_MANUAL_TORRE', bypassCooldown: true }),
  });
  const data = await res.json();
  if (data.ok) {
    showToast(`Recuperación ejecutada (${data.event?.channel}) para ${s.leadName}`, 'ok');
    fetchStatus();
  } else {
    showToast(data.reason || data.error || 'No se pudo disparar', 'err');
  }
};

function renderAdvisorQueue(events) {
  const urgent = events.filter((e) => e.channel === 'ALERTA_ASESOR_LLAMADA' && e.status !== 'CONVERTIDO_PAYER');
  const pendingCount = urgent.filter((e) => !e.advisorClaimedAt).length;
  document.getElementById('badgePendingAdvisor').textContent = `${pendingCount} pendientes`;

  const box = document.getElementById('advisorQueueList');
  if (!urgent.length) {
    box.innerHTML = '<div class="empty-box">Sin alertas urgentes (&gt;10 min) pendientes en cola SLA.</div>';
    return;
  }
  box.innerHTML = urgent.slice(0, 6).map((e) => {
    const claimed = Boolean(e.advisorClaimedAt);
    return `
      <div class="advisor-item">
        <div style="flex:1;min-width:220px;">
          <div><strong>${esc(e.leadName)}</strong> · <span class="status-pill danger">${e.probability}% prob.</span> ${claimed ? `<span class="status-pill ok">SLA ${e.slaSeconds}s</span>` : ''}</div>
          <div class="muted-sm">${esc(e.productName)} (${fmtMoney(e.productPrice)}) · ${esc(e.durationLabel)}</div>
          <div class="muted-sm"><em>Guion:</em> "${esc(e.advisorScript?.opening || 'Llamar al cliente ahora')}"</div>
        </div>
        <div class="btn-row">
          ${e.telCallUrl ? `<a class="btn btn-outline btn-xs" href="${esc(e.telCallUrl)}">Llamar ${esc(e.leadPhone)}</a>` : ''}
          ${!claimed ? `<button class="btn btn-amber btn-xs" onclick="claimAdvisor(${e.id})">Marcar Atendido</button>` : ''}
          <button class="btn btn-emerald btn-xs" onclick="convertEventToPayer(${e.id})">Pago → PAYER</button>
        </div>
      </div>
    `;
  }).join('');
}

window.claimAdvisor = async function (id) {
  const res = await fetch(`/api/retargeting/${id}/advisor-claim`, { method: 'POST' });
  const data = await res.json();
  if (data.ok) {
    showToast(`SLA registrado en ${data.event?.slaSeconds || 0}s.`, 'ok');
    fetchStatus();
  }
};

function renderAbStats(abStats) {
  const box = document.getElementById('abStatsGrid');
  const entries = Object.entries(abStats);
  if (!entries.length) return;
  box.innerHTML = entries.map(([key, st]) => {
    const sent = Number(st.sent || 0);
    const conv = Number(st.converted || 0);
    const rate = sent > 0 ? Math.round((conv / sent) * 100) : 0;
    return `
      <div class="ab-card">
        <div class="muted-sm mono">${esc(key)}</div>
        <strong style="font-size:14px;">${esc(st.label || key)}</strong>
        <div class="muted-sm mt-2">Enviados: <strong>${sent}</strong> · Convertidos: <strong>${conv}</strong> · Tasa: <strong>${rate}%</strong></div>
        <div class="ab-bar-bg"><div class="ab-bar-fill" style="width:${rate}%;"></div></div>
      </div>
    `;
  }).join('');
}

// ---------------------------------------------------------------------------
// 3. TAB 2: DIRECTORIO DE LEADS (CRUD PERSISTENTE)
// ---------------------------------------------------------------------------
function renderLeadsTable(leads) {
  const q = (document.getElementById('leadSearchInput')?.value || '').trim().toLowerCase();
  const filtered = leads.filter((l) => {
    if (!q) return true;
    return `${l.firstName} ${l.lastName} ${l.phone} ${l.email} ${l.district}`.toLowerCase().includes(q);
  });

  const tbody = document.getElementById('leadsTableBody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted-sm" style="text-align:center;padding:18px;">Sin registros coincidentes.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((l) => {
    const stageCls = l.stage === 'PAYER' ? 'ok' : 'blue';
    return `
      <tr>
        <td>${l.id}</td>
        <td><strong>${esc(l.firstName)} ${esc(l.lastName)}</strong><div class="muted-sm">${esc(l.district || '')}</div></td>
        <td>${esc(l.phone || '—')}</td>
        <td>${esc(l.email || '—')}</td>
        <td><span class="status-pill ${stageCls}">${esc(l.stage || 'LEAD')}</span></td>
        <td>
          <div class="btn-row">
            <button class="btn btn-outline btn-xs" onclick="useLeadInTest(${l.id})">Probar</button>
            <button class="btn btn-outline btn-xs" onclick="editLead(${l.id})">Editar</button>
            <button class="btn btn-danger btn-xs" onclick="deleteLead(${l.id})">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('leadSearchInput').addEventListener('input', () => {
  if (latestStatus) renderLeadsTable(latestStatus.leads || []);
});

document.getElementById('leadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editId = document.getElementById('leadEditId').value;
  const payload = {
    firstName: document.getElementById('leadFirstName').value.trim(),
    lastName: document.getElementById('leadLastName').value.trim(),
    phone: document.getElementById('leadPhone').value.trim(),
    email: document.getElementById('leadEmail').value.trim(),
    documentNumber: document.getElementById('leadDoc').value.trim(),
    district: document.getElementById('leadDistrict').value.trim(),
    stage: document.getElementById('leadStage').value,
    notes: document.getElementById('leadNotes').value.trim(),
  };

  const url = editId ? `/api/leads/${editId}` : '/api/leads';
  const method = editId ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.ok) {
    showToast(`Contacto guardado permanentemente (${data.lead?.firstName} · ${data.lead?.phone || data.lead?.email}).`, 'ok');
    resetLeadForm();
    fetchStatus();
  } else {
    showToast(data.error || 'Error guardando contacto', 'err');
  }
});

function resetLeadForm() {
  document.getElementById('leadEditId').value = '';
  document.getElementById('leadFormTitle').textContent = 'Guardar / Editar Contacto LEAD';
  document.getElementById('leadForm').reset();
}
document.getElementById('btnResetLeadForm').addEventListener('click', resetLeadForm);

window.editLead = function (id) {
  const l = (latestStatus?.leads || []).find((x) => Number(x.id) === Number(id));
  if (!l) return;
  document.getElementById('leadEditId').value = l.id;
  document.getElementById('leadFormTitle').textContent = `Editando LEAD #${l.id}`;
  document.getElementById('leadFirstName').value = l.firstName || '';
  document.getElementById('leadLastName').value = l.lastName || '';
  document.getElementById('leadPhone').value = l.phone || '';
  document.getElementById('leadEmail').value = l.email || '';
  document.getElementById('leadDoc').value = l.documentNumber || '';
  document.getElementById('leadDistrict').value = l.district || '';
  document.getElementById('leadStage').value = l.stage || 'LEAD';
  document.getElementById('leadNotes').value = l.notes || '';
};

window.deleteLead = async function (id) {
  const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.ok) {
    showToast(`Contacto #${id} eliminado del directorio.`, 'ok');
    fetchStatus();
  }
};

window.useLeadInTest = function (id) {
  const l = (latestStatus?.leads || []).find((x) => Number(x.id) === Number(id));
  if (!l) return;
  document.getElementById('testLeadName').value = `${l.firstName || ''} ${l.lastName || ''}`.trim();
  document.getElementById('testLeadPhone').value = l.phone || '';
  document.getElementById('testLeadEmail').value = l.email || '';
  saveQuickTestToLocalStorage();
  document.querySelector('[data-tab="config"]').click();
  showToast(`LEAD ${l.firstName} cargado en la Consola de Disparo.`, 'ok');
};

// ---------------------------------------------------------------------------
// 4. TAB 3: HISTORIAL, XAI TRACE, CHAT BIDIRECCIONAL & VISOR EMAIL
// ---------------------------------------------------------------------------
document.getElementById('eventsFilter').addEventListener('change', () => {
  if (latestStatus) renderEventsFeed(latestStatus.events || []);
});

function renderEventsFeed(events) {
  const filter = document.getElementById('eventsFilter').value;
  const filtered = events.filter((e) => {
    if (filter === 'ALL') return true;
    if (filter === 'CONVERTIDO_PAYER') return e.status === 'CONVERTIDO_PAYER';
    return e.channel === filter;
  });

  const box = document.getElementById('eventsFeed');
  if (!filtered.length) {
    box.innerHTML = '<div class="empty-box">No hay eventos en esta categoría.</div>';
    return;
  }

  box.innerHTML = filtered.slice(0, 40).map((ev) => {
    const isPayer = ev.status === 'CONVERTIDO_PAYER';
    const convCount = Array.isArray(ev.conversation) ? ev.conversation.length : 0;
    const traces = Array.isArray(ev.decisionTrace) ? ev.decisionTrace : [];
    const deliveryOk = ev.deliveryResult?.sent;

    return `
      <div class="event-card ${isPayer ? 'converted' : ''}">
        <div class="event-top">
          <div>
            <strong>${esc(ev.leadName)}</strong>
            <span class="muted-sm">(${esc(ev.leadPhone || 'Sin tel')} · ${esc(ev.leadEmail || 'Sin email')})</span>
            <div class="muted-sm">
              Tienda: <strong>${esc(ev.sourceStore || 'Tienda Demo')}</strong> · Producto: <strong>${esc(ev.productName)}</strong> (${fmtMoney(ev.productPrice)}) · Permanencia: <strong>${esc(ev.durationLabel)}</strong> · Score: <strong>${ev.probability}%</strong>
            </div>
          </div>
          <div class="btn-row">
            <span class="status-pill ${isPayer ? 'ok' : 'blue'}">${esc(ev.state || ev.status)}</span>
            <span class="status-pill neutral">${esc(ev.channel)}</span>
          </div>
        </div>

        <div class="badge-strip">
          <span class="status-pill ${deliveryOk ? 'ok' : 'warn'}">${deliveryOk ? 'Entrega Real OK' : `Fallback / Local (${esc(ev.deliveryResult?.reason || 'Simulado')})`}</span>
          ${ev.openedAt ? '<span class="status-pill ok">Correo Abierto (Píxel 1×1)</span>' : ''}
          ${ev.clickedAt ? '<span class="status-pill ok">Clic en Link Mágico</span>' : ''}
          ${ev.couponCode ? `<span class="status-pill warn">Cupón Guardrail: ${esc(ev.couponCode)}</span>` : ''}
          ${ev.touch2SentAt ? '<span class="status-pill blue">Toque 2 Autónomo Enviado</span>' : ''}
          ${isPayer ? `<span class="status-pill ok">Comprobante ${esc(ev.paymentInfo?.receiptNumber || 'SUNAT')}</span>` : ''}
        </div>

        <div class="xai-box">
          <strong>Trazabilidad XAI (${esc(ev.strategyLabel || ev.strategyKey || 'Estrategia')}):</strong>
          <ul>${traces.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        </div>

        <div class="btn-row mt-2">
          <button class="btn btn-outline btn-sm" onclick="openChatModal(${ev.id})">Chat WhatsApp (${convCount})</button>
          <button class="btn btn-outline btn-sm" onclick="openEmailModal(${ev.id})">Ver Correo HTML</button>
          ${ev.trackingClickUrl ? `<a class="btn btn-outline btn-sm" href="${esc(ev.trackingClickUrl)}" target="_blank">Probar Link Mágico ↗</a>` : ''}
          ${!isPayer ? `<button class="btn btn-emerald btn-sm" onclick="convertEventToPayer(${ev.id})">Confirmar Pago → PAYER</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.convertEventToPayer = async function (id) {
  const res = await fetch(`/api/retargeting/${id}/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentMethod: 'YAPE' }),
  });
  const data = await res.json();
  if (data.ok) {
    showToast(`Conversión LEAD → PAYER registrada (${data.event?.paymentInfo?.receiptNumber}).`, 'ok');
    fetchStatus();
  } else {
    showToast(data.error || 'Error convirtiendo a PAYER', 'err');
  }
};

// MODAL CHAT BIDIRECCIONAL
let lastChatMsgCount = -1;
window.openChatModal = function (id) {
  const ev = (latestStatus?.events || []).find((e) => Number(e.id) === Number(id));
  if (!ev) return;
  activeChatEventId = id;
  lastChatMsgCount = -1;
  document.getElementById('chatModalTitle').textContent = `WhatsApp Bidireccional · ${ev.leadName}`;
  document.getElementById('chatModalSub').textContent = `${ev.leadPhone || 'Sin número'} · ${ev.productName} · Token ${ev.recoverToken}`;
  document.getElementById('chatTraceSummary').textContent = `Estrategia: ${ev.strategyLabel || ev.strategyKey} | Tope descuento: ${latestStatus?.config?.maxDiscountPercent || 5}%`;
  document.getElementById('chatModal').classList.remove('hidden');
  renderChatMessages(ev);
};

function renderChatMessages(ev) {
  const box = document.getElementById('chatMessagesBox');
  const msgs = Array.isArray(ev.conversation) ? ev.conversation : [];
  if (!msgs.length) {
    box.innerHTML = '<div class="empty-box">Sin mensajes registrados aún en este hilo. Envía una respuesta abajo para iniciar por WhatsApp.</div>';
    return;
  }
  if (msgs.length === lastChatMsgCount) return;
  lastChatMsgCount = msgs.length;
  box.innerHTML = msgs.map((m) => {
    const isClient = m.from === 'CLIENT';
    const ts = m.at ? new Date(m.at).toLocaleTimeString('es-PE') : '';
    return `
      <div class="msg-bubble ${isClient ? 'client' : 'agent'}">
        <div>${esc(m.text)}</div>
        <div class="msg-meta">${isClient ? 'LEAD (Cliente)' : `Agente (${esc(m.action || 'AUTO')})`} · ${ts}</div>
      </div>
    `;
  }).join('');
  requestAnimationFrame(() => {
    box.scrollTop = box.scrollHeight;
  });
}

window.closeChatModal = function () {
  activeChatEventId = null;
  document.getElementById('chatModal').classList.add('hidden');
};

document.getElementById('manualReplyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeChatEventId) return;
  const input = document.getElementById('manualReplyInput');
  const text = input.value.trim();
  if (!text) return;
  const res = await fetch(`/api/retargeting/${activeChatEventId}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  input.value = '';
  if (data.delivery?.sent) {
    showToast('Mensaje enviado en vivo al WhatsApp del cliente.', 'ok');
  } else {
    showToast(`Guardado en historial (${data.delivery?.reason || 'WhatsApp no conectado'}).`, 'err');
  }
  fetchStatus();
});

document.getElementById('btnSimulateClientNlu').addEventListener('click', async () => {
  if (!activeChatEventId) return;
  const input = document.getElementById('manualReplyInput');
  const text = input.value.trim() || 'Está muy caro, ¿hay descuento?';
  const res = await fetch(`/api/retargeting/${activeChatEventId}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, simulateClient: true }),
  });
  const data = await res.json();
  input.value = '';
  if (data.ok) {
    showToast(`NLU detectó intent ${data.simulatedNlu?.intent} → ${data.simulatedNlu?.action}`, 'ok');
    fetchStatus();
  }
});

// MODAL VISOR CORREO HTML
window.openEmailModal = function (id) {
  const ev = (latestStatus?.events || []).find((e) => Number(e.id) === Number(id));
  if (!ev) return;
  document.getElementById('emailModalTitle').textContent = `Correo HTML · ${ev.leadEmail || ev.leadName}`;
  document.getElementById('emailModalSub').textContent = `Token ${ev.recoverToken} · Estrategia: ${ev.strategyLabel || 'Recuperación'}`;
  document.getElementById('emailPreviewFrame').src = `/api/retargeting/${id}/email-preview`;
  document.getElementById('emailModal').classList.remove('hidden');
};
window.closeEmailModal = function () {
  document.getElementById('emailPreviewFrame').src = 'about:blank';
  document.getElementById('emailModal').classList.add('hidden');
};

// ---------------------------------------------------------------------------
// 5. TAB 4: PRUEBAS CONTROLADAS, WHATSAPP QR, CONFIG Y SDK
// ---------------------------------------------------------------------------
let configHydrated = false;
function syncDropdownsAndConfig(data) {
  // Select productos
  const prodSel = document.getElementById('testProductSelect');
  const prevProd = prodSel.value;
  prodSel.innerHTML = (data.catalog || []).map((p) => `<option value="${esc(p.slug)}">${esc(p.name)} (${fmtMoney(p.price)})</option>`).join('');
  if (prevProd) prodSel.value = prevProd;

  // Select leads
  const leadSel = document.getElementById('testLeadSelect');
  const prevLead = leadSel.value;
  leadSel.innerHTML = '<option value="">-- Usar datos escritos abajo --</option>' +
    (data.leads || []).map((l) => `<option value="${l.id}">${esc(l.firstName)} ${esc(l.lastName)} · ${esc(l.phone || l.email)}</option>`).join('');
  if (prevLead) leadSel.value = prevLead;

  // WhatsApp QR Box
  const wa = data.whatsapp || {};
  const qrBox = document.getElementById('waQrBox');
  const connBox = document.getElementById('waConnectedBox');
  if (wa.state === 'CONNECTED') {
    qrBox.classList.add('hidden');
    connBox.classList.remove('hidden');
    connBox.innerHTML = `<div class="status-pill ok">WhatsApp Conectado en Vivo: +${esc(wa.connectedPhone)} (${esc(wa.connectedName || 'Agente')})</div>`;
  } else if (wa.qrDataUrl) {
    connBox.classList.add('hidden');
    qrBox.classList.remove('hidden');
    qrBox.innerHTML = `<div><strong>Escanea este QR con WhatsApp</strong> (Dispositivos vinculados):</div><img src="${wa.qrDataUrl}" alt="QR WhatsApp" />`;
  } else {
    connBox.classList.add('hidden');
    qrBox.classList.remove('hidden');
    qrBox.textContent = `Estado WhatsApp: ${wa.state || 'Inicializando'} ${wa.lastError ? '(' + wa.lastError + ')' : ''}`;
  }

  // Config inputs (solo hidratar 1 vez para no pisar edición del usuario)
  if (!configHydrated && data.config) {
    const c = data.config;
    document.getElementById('cfgStoreName').value = c.storeName || '';
    document.getElementById('cfgStoreUrl').value = c.storeUrl || '';
    document.getElementById('cfgStoreAddress').value = c.storeAddress || '';
    document.getElementById('cfgAdvisorName').value = c.advisorName || '';
    document.getElementById('cfgAdvisorPhone').value = c.advisorPhone || '';
    document.getElementById('cfgAdvisorEmail').value = c.advisorEmail || '';
    document.getElementById('cfgEmailMax').value = c.emailMaxSeconds || 300;
    document.getElementById('cfgWaMax').value = c.whatsappMaxSeconds || 600;
    document.getElementById('cfgTouch2').value = c.touch2DelaySeconds || 180;
    document.getElementById('cfgMaxDiscount').value = c.maxDiscountPercent || 5;
    document.getElementById('cfgCooldown').value = c.cooldownMinutes ?? 10;
    document.getElementById('cfgQuietHours').value = String(Boolean(c.quietHoursEnabled));
    document.getElementById('cfgSmtpHost').value = c.smtpHost || 'smtp.gmail.com';
    document.getElementById('cfgSmtpPort').value = c.smtpPort || 465;
    document.getElementById('cfgSmtpUser').value = c.smtpUser || '';
    document.getElementById('diagEmailInput').value = c.advisorEmail || 'asesor@roo-soluciones.pe';
    document.getElementById('diagPhoneInput').value = c.advisorPhone || '+51 900 000 001';
    configHydrated = true;
  }

  const storeAttr = esc(data.config?.storeName || 'Mi Tienda Online');
  document.getElementById('sdkSnippetCode').textContent = `<script src="${window.location.origin}/sdk/roo-agent.js" data-store="${storeAttr}"></script>`;
}

// LocalStorage persistencia en Consola de Prueba Rápida
function saveQuickTestToLocalStorage() {
  try {
    localStorage.setItem(QUICK_TEST_LS_KEY, JSON.stringify({
      name: document.getElementById('testLeadName').value,
      phone: document.getElementById('testLeadPhone').value,
      email: document.getElementById('testLeadEmail').value,
      secs: document.getElementById('testSecondsInput').value,
    }));
  } catch (_) {}
}
(function loadQuickTestFromLocalStorage() {
  try {
    const raw = localStorage.getItem(QUICK_TEST_LS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.name) document.getElementById('testLeadName').value = saved.name;
    if (saved.phone) document.getElementById('testLeadPhone').value = saved.phone;
    if (saved.email) document.getElementById('testLeadEmail').value = saved.email;
    if (saved.secs) document.getElementById('testSecondsInput').value = saved.secs;
  } catch (_) {}
})();

['testLeadName', 'testLeadPhone', 'testLeadEmail', 'testSecondsInput'].forEach((id) => {
  document.getElementById(id).addEventListener('input', saveQuickTestToLocalStorage);
});

document.getElementById('testLeadSelect').addEventListener('change', (e) => {
  const id = e.target.value;
  const l = (latestStatus?.leads || []).find((x) => Number(x.id) === Number(id));
  if (!l) return;
  document.getElementById('testLeadName').value = `${l.firstName || ''} ${l.lastName || ''}`.trim();
  document.getElementById('testLeadPhone').value = l.phone || '';
  document.getElementById('testLeadEmail').value = l.email || '';
  saveQuickTestToLocalStorage();
});

window.setTestPreset = function (secs) {
  document.getElementById('testSecondsInput').value = secs;
  saveQuickTestToLocalStorage();
};

document.getElementById('btnSaveQuickLead').addEventListener('click', async () => {
  const name = document.getElementById('testLeadName').value.trim();
  const phone = document.getElementById('testLeadPhone').value.trim();
  const email = document.getElementById('testLeadEmail').value.trim();
  const res = await fetch('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadName: name, phone, email }),
  });
  const data = await res.json();
  if (data.ok) {
    showToast(`Contacto ${data.lead?.firstName} guardado en el Directorio Persistente.`, 'ok');
    fetchStatus();
  } else {
    showToast(data.error || 'Ingresa teléfono o correo válido', 'err');
  }
});

document.getElementById('btnRunControlledTest').addEventListener('click', async () => {
  const name = document.getElementById('testLeadName').value.trim() || 'Cliente Demo';
  const phone = document.getElementById('testLeadPhone').value.trim();
  const email = document.getElementById('testLeadEmail').value.trim();
  const slug = document.getElementById('testProductSelect').value;
  const secs = Number(document.getElementById('testSecondsInput').value || 180);

  const res = await fetch('/api/retargeting/abandon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      leadName: name,
      phone,
      email,
      productSlug: slug,
      secondsViewed: secs,
      interactions: { startedCheckout: true, cartCount: 1, clicks: 4 },
      bypassCooldown: true,
      exitReason: 'PRUEBA_CONTROLADA_TORRE',
    }),
  });
  const data = await res.json();
  if (data.ok) {
    showToast(`Canal elegido: ${data.event?.channel} (${data.event?.probability}% prob.) · Revisa pestaña Historial.`, 'ok');
    fetchStatus();
  } else {
    showToast(data.reason || data.error || 'Error ejecutando prueba', 'err');
  }
});

document.getElementById('btnDiagEmail').addEventListener('click', async () => {
  const email = document.getElementById('diagEmailInput').value.trim();
  const res = await fetch('/api/test/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, productSlug: document.getElementById('testProductSelect').value }),
  });
  const data = await res.json();
  showToast(data.ok ? `Correo SMTP enviado a ${email} (${data.smtp?.mode})` : `Error SMTP: ${data.delivery?.reason}`, data.ok ? 'ok' : 'err');
});

document.getElementById('btnDiagWa').addEventListener('click', async () => {
  const phone = document.getElementById('diagPhoneInput').value.trim();
  const res = await fetch('/api/test/whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, productSlug: document.getElementById('testProductSelect').value }),
  });
  const data = await res.json();
  showToast(data.ok ? `WhatsApp real enviado a ${phone}` : `Error WhatsApp: ${data.delivery?.reason}`, data.ok ? 'ok' : 'err');
});

window.applyStorePreset = function (mode) {
  if (mode === 'external') {
    document.getElementById('cfgStoreName').value = 'Mi Tienda Online';
    document.getElementById('cfgStoreUrl').value = 'http://localhost:8080/landing';
  } else {
    document.getElementById('cfgStoreName').value = 'Tienda Demo · roo';
    document.getElementById('cfgStoreUrl').value = `${window.location.origin}/demo-shop.html`;
  }
  showToast('Preset cargado. Presiona Guardar Configuración para aplicar.', 'ok');
};

document.getElementById('configForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    storeName: document.getElementById('cfgStoreName').value.trim(),
    storeUrl: document.getElementById('cfgStoreUrl').value.trim(),
    storeAddress: document.getElementById('cfgStoreAddress').value.trim(),
    advisorName: document.getElementById('cfgAdvisorName').value.trim(),
    advisorPhone: document.getElementById('cfgAdvisorPhone').value.trim(),
    advisorEmail: document.getElementById('cfgAdvisorEmail').value.trim(),
    emailMaxSeconds: Number(document.getElementById('cfgEmailMax').value),
    whatsappMaxSeconds: Number(document.getElementById('cfgWaMax').value),
    touch2DelaySeconds: Number(document.getElementById('cfgTouch2').value),
    maxDiscountPercent: Number(document.getElementById('cfgMaxDiscount').value),
    cooldownMinutes: Number(document.getElementById('cfgCooldown').value),
    quietHoursEnabled: document.getElementById('cfgQuietHours').value === 'true',
    smtpHost: document.getElementById('cfgSmtpHost').value.trim(),
    smtpPort: Number(document.getElementById('cfgSmtpPort').value),
    smtpUser: document.getElementById('cfgSmtpUser').value.trim(),
    smtpPass: document.getElementById('cfgSmtpPass').value,
    geminiApiKey: document.getElementById('cfgGeminiKey').value,
  };
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.ok) {
    document.getElementById('cfgSmtpPass').value = '';
    document.getElementById('cfgGeminiKey').value = '';
    configHydrated = false;
    showToast(`Configuración guardada. SMTP: ${data.smtp?.mode || 'Actualizado'}.`, 'ok');
    fetchStatus();
  } else {
    showToast(data.error || 'Error guardando configuración', 'err');
  }
});

document.getElementById('btnResetWa').addEventListener('click', async () => {
  await fetch('/api/whatsapp/reset', { method: 'POST' });
  showToast('Sesión WhatsApp reiniciada. Esperando nuevo código QR...', 'ok');
  fetchStatus();
});

document.getElementById('btnCopySdk').addEventListener('click', async () => {
  const txt = document.getElementById('sdkSnippetCode').textContent;
  await navigator.clipboard.writeText(txt).catch(() => {});
  showToast('Snippet <script> del SDK Universal Roo copiado al portapapeles.', 'ok');
});

document.getElementById('customProductForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('custProdName').value.trim();
  const price = Number(document.getElementById('custProdPrice').value);
  const res = await fetch('/api/catalog/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, price }),
  });
  const data = await res.json();
  if (data.ok) {
    document.getElementById('custProdName').value = '';
    document.getElementById('custProdPrice').value = '';
    showToast(`SKU "${data.product?.name}" agregado al catálogo universal.`, 'ok');
    fetchStatus();
  }
});

document.getElementById('btnRefreshNow').addEventListener('click', fetchStatus);

fetchStatus();
setInterval(fetchStatus, 2500);
