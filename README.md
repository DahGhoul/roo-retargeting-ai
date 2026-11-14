# Roo Retargeting AI

> *Agente Autónomo Omnicanal de Recuperación de Intención de Compra (`LEAD` → `PAYER`) · Proyecto de Ingeniería de Sistemas (UNT)*

Agente autónomo y omnicanal de recuperación de intención de compra (**Fase `LEAD` → `PAYER`**) basado en **Tiempo de Permanencia (*Dwell Time*)**, **scoring explicable (XAI)**, **bot conversacional WhatsApp (NLU + Guardrail anti-margen)** y **SDK web universal** embebible en cualquier tienda e-commerce.

**Autores y Derechos de Autor:**
- **Diego Joel Cuba Moya** & **Ronaldo Carlos Robles Romero**
- © 2026 Todos los derechos reservados *(código de demostración académica; contactos semilla configurables localmente mediante `.env` / `data/retargeting_state.json` excluidos del repositorio).*

---

## Arquitectura y Capacidades Principales

1. **SDK Universal (`<script src="/sdk/roo-agent.js">`)**: Sensor ligero compatible con HTML estático, React, Vue, Shopify o WooCommerce. Mide permanencia real, eventos de carrito/comparación y captura leads mediante *heartbeat* y *exit-intent* (`navigator.sendBeacon`).
2. **Motor de Decisión por 3 Reglas de Permanencia + XAI**:
   - **Tier 1 (`< 5 min`, `0–299 seg`)**: Interés exploratorio → Envía **Correo HTML real** vía **Nodemailer (Gmail SMTP o Ethereal)** con píxel de apertura (`1x1 PNG`) y enlace mágico rastreado (`/r/:token`).
   - **Tier 2 (`5–10 min`, `300–600 seg`)**: Compra posible → Envía **WhatsApp directo con ficha del producto** vía `@whiskeysockets/baileys` + enlace de recuperación en 1 clic.
   - **Tier 3 (`> 10 min`, `> 600 seg`)**: Intención crítica → Escala **alerta urgente al Asesor Comercial** con guion dinámico de cierre telefónico y seguimiento SLA.
3. **Bot Conversacional WhatsApp (NLU de 8 Intenciones + Guardrail Anti-Margen)**:
   - Responde objeciones de precio, stock, cuotas sin interés, garantía y envío; **nunca regala descuento en el primer turno** (solo tras insistencia en Turno 2 genera un cupón único `ROO-VIP-*` acotado al tope `maxDiscountPercent`).
4. **Higiene Anti-Spam y Persistencia Atómica Zero-DDL**:
   - Cooldown por producto/lead, tope diario (`dailyCapPerLead`), *Quiet Hours* y Fallback Cross-Channel (WhatsApp → Email).
   - Persistencia 100% autónoma en JSON atómico (`data/retargeting_state.json`) sin exigir tablas nuevas en base de datos, más conector SQL Server opcional solo-DML para la transición `LEAD` → `PAYER`.
5. **Tienda Demo SDK Integrada (`/demo-shop.html`)**: Storefront demostrativo incluido para probar todo el ciclo desde la captura de abandono hasta el **Magic Recovery Link** y emisión de comprobante `PAYER`.

---

## Cómo ejecutar en Windows, macOS / Linux o Docker

### Opción A: Windows
1. Haz doble clic en **`INICIAR_AGENTE_RETARGETING.bat`** (o `iniciar_windows.bat`).
2. Se abrirá automáticamente **`http://localhost:4000`** (Centro de Control) y podrás probar la tienda integrada en **`http://localhost:4000/demo-shop.html`**.

### Opción B: macOS / Linux / Terminal
```bash
git clone https://github.com/DahGhoul/roo-retargeting-ai.git
cd roo-retargeting-ai
cp .env.example .env
npm install
npm start
```
*(En macOS/Linux también puedes ejecutar `chmod +x iniciar_mac_linux.sh && ./iniciar_mac_linux.sh`.)*

### Opción C: Docker
```bash
docker compose up -d --build
```

---

## Vinculación de WhatsApp y Correo SMTP Real

1. Abre **`http://localhost:4000`** y entra a la pestaña **Configuración**.
2. Escanea el **Código QR de WhatsApp** con tu teléfono (*Dispositivos vinculados → Vincular un dispositivo*). La sesión se guarda localmente en `wa_auth_session/` (excluida de Git).
3. Ingresa tus credenciales **Gmail SMTP (App Password)** o variables en `.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) y valida desde **Diagnóstico Directo** en la pestaña **Consola**.
4. Para embeber el agente en cualquier tienda externa, inserta:
```html
<script src="http://localhost:4000/sdk/roo-agent.js" data-store="Mi Tienda"></script>
```
