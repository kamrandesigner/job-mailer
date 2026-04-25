// ═══════════════════════════════════════════════════════════════════════════
// JobMailer — Backend Server (Cloud-Ready)
// ═══════════════════════════════════════════════════════════════════════════

require("dotenv").config();
const express = require("express");
const multer  = require("multer");
const nodemailer = require("nodemailer");
const XLSX = require("xlsx");
const path = require("path");
const cors = require("cors");

const app  = express();
const PORT = process.env.PORT || 3000;   // Cloud hosts inject PORT automatically
const HOST = "0.0.0.0";                  // Required for Railway / Render / Glitch

// ─── Middleware ───────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "../frontend/public")));

// Memory storage — no disk writes, works on every cloud host
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ok = [".xlsx", ".xls", ".csv"].includes(
      path.extname(file.originalname).toLowerCase()
    );
    ok ? cb(null, true) : cb(new Error("Only .xlsx / .xls / .csv allowed"));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ─── State ───────────────────────────────────────────────────────────────
let smtpTransporter = null;
let smtpConfig      = null;

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// Health-check — Railway / Render ping this to confirm the app is alive
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

// 1. Connect SMTP
app.post("/api/smtp/connect", async (req, res) => {
  try {
    const { host, port, encryption, email, password, fromName } = req.body;
    if (!host || !email || !password)
      return res.status(400).json({ error: "Host, email, and password are required" });

    const cfg = {
      host,
      port: parseInt(port) || 587,
      secure: encryption === "SSL",
      auth: { user: email, pass: password },
      tls:  { rejectUnauthorized: false },
    };
    if (encryption === "TLS") { cfg.secure = false; cfg.requireTLS = true; }

    const t = nodemailer.createTransport(cfg);
    await t.verify();

    smtpTransporter = t;
    smtpConfig = { host, port, encryption, email, password, fromName };

    console.log(`✅ SMTP: ${email} @ ${host}:${port}`);
    res.json({ success: true, message: "SMTP connection verified" });
  } catch (err) {
    console.error("❌ SMTP:", err.message);
    res.status(400).json({ error: "SMTP connection failed", details: err.message, hint: smtpHint(err.message) });
  }
});

// 2. Disconnect SMTP
app.post("/api/smtp/disconnect", (_req, res) => {
  smtpTransporter?.close();
  smtpTransporter = smtpConfig = null;
  res.json({ success: true });
});

// 3. SMTP status
app.get("/api/smtp/status", (_req, res) =>
  res.json({ connected: !!smtpTransporter, email: smtpConfig?.email || null, host: smtpConfig?.host || null })
);

// 4. Upload contacts (Excel / CSV) — parsed from buffer, no disk needed
app.post("/api/contacts/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const wb   = XLSX.read(req.file.buffer, { type: "buffer" });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { defval: "" });

    if (!data.length) return res.status(400).json({ error: "File is empty" });

    const columns  = Object.keys(data[0]);
    const emailCol = columns.find(c => /e.?mail/i.test(c));

    if (!emailCol)
      return res.status(400).json({
        error: 'No email column found. Add a column named "email" to your file.',
        columns,
      });

    const contacts = data
      .map((row, i) => ({ _id: `c_${Date.now()}_${i}`, ...row }))
      .filter(row => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row[emailCol]).trim()));

    console.log(`📁 ${contacts.length} valid contacts (${data.length - contacts.length} skipped)`);
    res.json({
      success: true, contacts, columns, emailColumn: emailCol,
      totalRows: data.length, validContacts: contacts.length,
      invalidSkipped: data.length - contacts.length,
    });
  } catch (err) {
    res.status(400).json({ error: "Failed to parse file", details: err.message });
  }
});

// 5. Test email
app.post("/api/email/test", async (req, res) => {
  if (!smtpTransporter) return res.status(400).json({ error: "SMTP not connected" });
  const { to, subject, body } = req.body;
  if (!to || !subject || !body) return res.status(400).json({ error: "to / subject / body required" });
  try {
    const r = await smtpTransporter.sendMail({
      from: fromAddr(),
      to, subject,
      text: body,
      html: body.replace(/\n/g, "<br>"),
    });
    res.json({ success: true, messageId: r.messageId });
  } catch (err) {
    res.status(400).json({ error: "Test email failed", details: err.message });
  }
});

// 6. Bulk send with SSE progress stream
app.post("/api/email/send-bulk", async (req, res) => {
  res.writeHead(200, {
    "Content-Type":    "text/event-stream",
    "Cache-Control":   "no-cache",
    "Connection":      "keep-alive",
    "X-Accel-Buffering": "no",    // Disable Nginx buffering on Railway/Render
  });

  const emit = d => res.write(`data: ${JSON.stringify(d)}\n\n`);

  if (!smtpTransporter) { emit({ type: "error", message: "SMTP not connected" }); return res.end(); }

  const { contacts, subject, body, delaySeconds = 5, attachments } = req.body;
  if (!contacts?.length) { emit({ type: "error", message: "No contacts" }); return res.end(); }

  let aborted = false;
  req.on("close", () => { aborted = true; });

  let sent = 0, failed = 0;
  emit({ type: "start", total: contacts.length, message: `Sending to ${contacts.length} contacts…` });

  for (let i = 0; i < contacts.length; i++) {
    if (aborted) { emit({ type: "aborted", sent, failed }); break; }

    const c = contacts[i];
    const emailKey = Object.keys(c).find(k => /email/i.test(k));
    const to = c[emailKey];

    if (!to) { failed++; emit({ type: "failed", index: i, email: "unknown", error: "No email", sent, failed }); continue; }

    try {
      const opts = {
        from: fromAddr(),
        to: String(to).trim(),
        subject: fill(subject, c),
        text: fill(body, c),
        html: fill(body, c).replace(/\n/g, "<br>"),
      };
      if (attachments?.length)
        opts.attachments = attachments.map(a => ({ filename: a.filename, content: a.content, encoding: "base64" }));

      const r = await smtpTransporter.sendMail(opts);
      sent++;
      emit({ type: "sent", index: i, email: to, messageId: r.messageId, sent, failed });
      console.log(`  ✉  [${i+1}/${contacts.length}] → ${to}`);
    } catch (err) {
      failed++;
      emit({ type: "failed", index: i, email: to, error: err.message, sent, failed });
      console.error(`  ✕  [${i+1}/${contacts.length}] ${to}: ${err.message}`);
    }

    if (i < contacts.length - 1 && !aborted)
      await new Promise(r => setTimeout(r, delaySeconds * 1000));
  }

  emit({ type: "complete", sent, failed, total: contacts.length, message: `Done — ${sent} sent, ${failed} failed` });
  res.end();
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════
const fill = (text, data) =>
  (text || "").replace(/\{\{(\w+)\}\}/g, (m, k) => (data[k] != null && data[k] !== "" ? String(data[k]) : m));

const fromAddr = () =>
  smtpConfig.fromName ? `"${smtpConfig.fromName}" <${smtpConfig.email}>` : smtpConfig.email;

function smtpHint(msg) {
  const m = msg.toLowerCase();
  if (/auth|login|credentials|password/.test(m))
    return "For Gmail, create an App Password at myaccount.google.com/apppasswords (not your regular password).";
  if (/certificate|self.signed/.test(m))
    return "Certificate error — try switching encryption to TLS.";
  if (/connect|timeout|econnrefused/.test(m))
    return "Cannot reach the SMTP server. Check the host/port settings.";
  if (/rate|too.many/.test(m))
    return "Rate limited — wait a few minutes and try again.";
  return "Check your SMTP settings and make sure your provider allows third-party access.";
}

// ─── Catch-all → serve frontend ─────────────────────────────────────────
app.get("*", (_req, res) =>
  res.sendFile(path.join(__dirname, "../frontend/public/index.html"))
);

// ─── Error handler ───────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError)
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start — bind 0.0.0.0 so cloud hosts can reach the server ────────────
app.listen(PORT, HOST, () =>
  console.log(`\n🚀  JobMailer running → http://localhost:${PORT}\n`)
);
