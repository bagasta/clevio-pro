require('dotenv').config();
const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool(); // from .env
const sessions = {}; // sessionId: { client, getQr, status, info, logs }

// === LOGIN CONFIG ===
const SECRET_KEY = process.env.JWT_SECRET || "supersecret";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";

// === ENDPOINT LOGIN (public) ===
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: "12h" });
    return res.json({ token });
  }
  res.status(401).json({ error: "Username/password salah" });
});

// === MIDDLEWARE AUTH (kecuali /login dan /sessions/:id/qr) ===
app.use((req, res, next) => {
  if (
    req.path === "/login" ||
    /^\/sessions\/[^/]+\/qr/.test(req.path)
  ) return next();
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    jwt.verify(auth.replace("Bearer ", ""), SECRET_KEY);
    next();
  } catch {
    res.status(401).json({ error: "Token salah/expired" });
  }
});

// === HELPER SESSION ID ===
function isValidSessionId(id) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

// ========== SESSION CRUD (DB) ==========
app.post('/sessions', async (req, res) => {
  const { sessionId, webhookUrl } = req.body;
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });
  if (!isValidSessionId(sessionId)) return res.status(400).json({ error: "SessionId hanya boleh huruf, angka, _ atau -" });
  try {
    const q = `
      INSERT INTO wa_sessions (session_id, webhook_url)
      VALUES ($1, $2)
      ON CONFLICT (session_id) DO UPDATE SET webhook_url = EXCLUDED.webhook_url, updated_at = NOW()
      RETURNING *`;
    const result = await pool.query(q, [sessionId, webhookUrl]);
    res.json({ session: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/sessions', async (req, res) => {
  const q = `SELECT * FROM wa_sessions ORDER BY id`;
  const result = await pool.query(q);
  res.json({ sessions: result.rows });
});

app.put('/sessions/:sessionId/webhook', async (req, res) => {
  const { sessionId } = req.params;
  if (!isValidSessionId(sessionId)) return res.status(400).json({ error: "SessionId hanya boleh huruf, angka, _ atau -" });
  const { webhookUrl } = req.body;
  if (!webhookUrl) return res.status(400).json({ error: "webhookUrl required" });
  const q = `UPDATE wa_sessions SET webhook_url=$1, updated_at=NOW() WHERE session_id=$2 RETURNING *`;
  const result = await pool.query(q, [webhookUrl, sessionId]);
  res.json({ session: result.rows[0] });
});

app.put('/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const { newSessionId, webhookUrl } = req.body;
  if (!newSessionId) return res.status(400).json({ error: "newSessionId required" });
  if (!isValidSessionId(sessionId) || !isValidSessionId(newSessionId)) {
    return res.status(400).json({ error: "SessionId hanya boleh huruf, angka, _ atau -" });
  }
  try {
    const q = `UPDATE wa_sessions SET session_id=$1, webhook_url=$2, updated_at=NOW() WHERE session_id=$3 RETURNING *`;
    const result = await pool.query(q, [newSessionId, webhookUrl, sessionId]);
    if (sessions[sessionId]) {
      sessions[newSessionId] = sessions[sessionId];
      delete sessions[sessionId];
    }
    res.json({ session: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  if (!isValidSessionId(sessionId)) return res.status(400).json({ error: "SessionId hanya boleh huruf, angka, _ atau -" });
  await pool.query(`DELETE FROM wa_sessions WHERE session_id=$1`, [sessionId]);
  if (sessions[sessionId]) {
    sessions[sessionId].client.destroy();
    delete sessions[sessionId];
  }
  res.json({ success: true });
});

app.post('/sessions/:sessionId/reset', async (req, res) => {
  const { sessionId } = req.params;
  if (!isValidSessionId(sessionId)) return res.status(400).json({ error: "SessionId hanya boleh huruf, angka, _ atau -" });
  if (sessions[sessionId]) {
    try { await sessions[sessionId].client.destroy(); } catch {}
    delete sessions[sessionId];
  }
  const dir = path.join('.wwebjs_auth', sessionId);
  fs.rmSync(dir, { recursive: true, force: true });
  res.json({ success: true });
});

// ============ Session Management & QR =============
app.post('/sessions/:sessionId/init', async (req, res) => {
  const { sessionId } = req.params;
  if (!isValidSessionId(sessionId)) {
    return res.status(400).json({ error: "SessionId hanya boleh huruf, angka, _ atau -" });
  }
  // Cari data session di DB
  const q = `SELECT * FROM wa_sessions WHERE session_id=$1`;
  const result = await pool.query(q, [sessionId]);
  if (result.rowCount === 0) return res.status(404).json({ error: "Session not found" });
  if (sessions[sessionId]) return res.json({ status: "already initialized" });

  let qrCodeData = "";
  const client = new Client({ authStrategy: new LocalAuth({ clientId: sessionId }) });

  // STATE session
  sessions[sessionId] = {
    client,
    getQr: () => qrCodeData,
    status: "initializing",
    info: null,
    logs: []
  };

  client.on('qr', qr => {
    qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
    sessions[sessionId].status = "initializing";
  });

  client.on('ready', () => {
    sessions[sessionId].status = "connected";
    const info = client.info;
    sessions[sessionId].info = info;
    console.log(`WA Client [${sessionId}] Connected as ${info.wid.user}`);
  });

  client.on('disconnected', (reason) => {
    sessions[sessionId].status = "disconnected";
    console.log(`WA Client [${sessionId}] Disconnected:`, reason);
  });

  // Log pesan masuk & auto-reply dari webhook
  client.on('message', async message => {
    sessions[sessionId].logs.push({
      direction: "in",
      from: message.from,
      to: message.to,
      type: message.type,
      body: message.body,
      timestamp: message.timestamp,
      hasMedia: message.hasMedia || false,
    });

    try {
      const webq = `SELECT webhook_url FROM wa_sessions WHERE session_id=$1`;
      const webres = await pool.query(webq, [sessionId]);
      const webhookUrl = webres.rows[0]?.webhook_url;
      if (!webhookUrl) return;

      let senderNumber = message.from.replace(/@.*/, '');
      let payload = {
        sessionId: senderNumber,
        from: message.from,
        to: message.to,
        body: message.body,
        type: message.type,
        timestamp: message.timestamp,
        group: message.isGroupMsg,
      };
      if (message.hasMedia) {
        const media = await message.downloadMedia();
        payload.media = media.data;
        payload.filename = media.filename;
        payload.mimetype = media.mimetype;
        payload.caption = message.caption || "";
      }
      // Cek group, harus mention bot
      if (message.isGroupMsg) {
        const info = client.info;
        if (!message.body.includes(info.wid.user)) return;
      }

      // --- Kirim ke webhook dan tunggu responnya
      const webhookRes = await axios.post(webhookUrl, payload, { timeout: 10000 });

      // --- Kirim balasan ke WA jika ada response dari webhook
      if (typeof webhookRes.data === "string" && webhookRes.data.trim() !== "") {
        // Balas teks (mode plain text)
        await client.sendMessage(message.from, webhookRes.data.trim());
        sessions[sessionId].logs.push({
          direction: "out",
          to: message.from,
          type: "text",
          body: webhookRes.data.trim(),
          timestamp: Math.floor(Date.now()/1000)
        });
      }
      else if (typeof webhookRes.data === "object" && webhookRes.data !== null) {
        // Balas teks (mode JSON)
        if (webhookRes.data.text) {
          await client.sendMessage(message.from, webhookRes.data.text);
          sessions[sessionId].logs.push({
            direction: "out",
            to: message.from,
            type: "text",
            body: webhookRes.data.text,
            timestamp: Math.floor(Date.now()/1000)
          });
        }
        // Balas media (image/audio/document/video)
        else if (webhookRes.data.media && webhookRes.data.mimetype) {
          const msgMedia = new MessageMedia(
            webhookRes.data.mimetype,
            webhookRes.data.media,
            webhookRes.data.filename || undefined
          );
          // Caption hanya dikirim untuk image/video
          let sendOptions = {};
          if (
            webhookRes.data.caption &&
            (webhookRes.data.mimetype.startsWith('image/') || webhookRes.data.mimetype.startsWith('video/'))
          ) {
            sendOptions.caption = webhookRes.data.caption;
          }
          await client.sendMessage(
            message.from,
            msgMedia,
            sendOptions
          );
          sessions[sessionId].logs.push({
            direction: "out",
            to: message.from,
            type: "media",
            body: webhookRes.data.caption || webhookRes.data.filename || "",
            timestamp: Math.floor(Date.now()/1000)
          });
        }
      }
      // else: jika kosong, tidak ada yang dikirim ke WA
    } catch (e) {
      // Optional: log error ke file atau console
      console.error('Auto-reply webhook/WA error:', e.message);
    }
  });

  client.initialize();
  res.json({ status: "initializing" });
});

// Get QR (public)
app.get('/sessions/:sessionId/qr', (req, res) => {
  const { sessionId } = req.params;
  if (!isValidSessionId(sessionId)) return res.status(400).json({ error: "SessionId hanya boleh huruf, angka, _ atau -" });
  if (!sessions[sessionId]) return res.status(404).json({ error: "Session not initialized" });
  if (sessions[sessionId].status === "connected") {
    return res.json({ qr: null });
  }
  res.json({ qr: sessions[sessionId].getQr() });
});

// Status
app.get('/sessions/:sessionId/status', (req, res) => {
  const { sessionId } = req.params;
  if (!isValidSessionId(sessionId)) return res.status(400).json({ error: "SessionId hanya boleh huruf, angka, _ atau -" });
  const s = sessions[sessionId];
  if (!s) return res.status(404).json({ status: "not initialized" });
  res.json({
    status: s.status,
    info: s.info || null
  });
});

// Log dari memory
app.get('/sessions/:sessionId/logs', (req, res) => {
  const { sessionId } = req.params;
  if (!isValidSessionId(sessionId)) return res.status(400).json({ error: "SessionId hanya boleh huruf, angka, _ atau -" });
  res.json({ logs: sessions[sessionId]?.logs || [] });
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Server running on :${PORT}`));
