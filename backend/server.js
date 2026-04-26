// ═══════════════════════════════════════════════════════════════════════════
// JobMailer — Backend Server with Authentication
// ═══════════════════════════════════════════════════════════════════════════

require("dotenv").config();
const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");
const XLSX = require("xlsx");
const path = require("path");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const auth = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

// ─── Middleware ───────────────────────────────────────────────────────────
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "../frontend/public")));

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

// ─── Per-user SMTP transporters (in-memory cache) ────────────────────────
const userTransporters = new Map();  // userId -> nodemailer transporter

function getUserTransporter(userId) {
  return userTransporters.get(userId);
}

function setUserTransporter(userId, transporter) {
  // Close existing
  const existing = userTransporters.get(userId);
  if (existing) existing.close();
  userTransporters.set(userId, transporter);
}

function clearUserTransporter(userId) {
  const existing = userTransporters.get(userId);
  if (existing) existing.close();
  userTransporters.delete(userId);
}

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════════════════════════════════════
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

// ═══════════════════════════════════════════════════════════════════════════
// AUTHENTICATION ROUTES
// ═══════════════════════════════════════════════════════════════════════════

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

// Signup
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const user = await auth.signup(email, password, name);
    // Auto-login after signup
    const result = await auth.login(email, password);
    res.cookie("auth_token", result.token, COOKIE_OPTS);
    res.json({ success: true, user: result.user, message: "Account created! Check your email to verify." });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await auth.login(email, password);
    res.cookie("auth_token", result.token, COOKIE_OPTS);
    res.json({ success: true, user: result.user });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// Logout
app.post("/api/auth/logout", auth.requireAuth, (req, res) => {
  clearUserTransporter(req.user.id);
  res.clearCookie("auth_token");
  res.json({ success: true });
});

// Get current user
app.get("/api/auth/me", auth.requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Verify email
app.get("/api/auth/verify", (req, res) => {
  const ok = auth.verifyEmail(req.query.token);
  res.send(`
    <html><head><title>Email Verification</title>
    <style>
      body{font-family:system-ui;background:#0e1117;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
      .box{background:#161b26;padding:40px;border-radius:12px;border:1px solid #222d40;text-align:center;max-width:400px}
      .icon{font-size:48px;margin-bottom:16px}
      a{color:#60a5fa;text-decoration:none}
    </style></head><body>
    <div class="box">
      <div class="icon">${ok ? "✅" : "❌"}</div>
      <h2>${ok ? "Email Verified!" : "Invalid Link"}</h2>
      <p>${ok ? "Your email has been verified successfully." : "This link is invalid or expired."}</p>
      <p><a href="/">← Back to JobMailer</a></p>
    </div></body></html>
  `);
});

// Request password reset
app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    await auth.requestPasswordReset(req.body.email);
    res.json({ success: true, message: "If an account exists with that email, a reset link has been sent." });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Reset password with token
app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    await auth.resetPassword(token, newPassword);
    res.json({ success: true, message: "Password reset successfully. Please log in." });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Change password (logged in)
app.post("/api/auth/change-password", auth.requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    await auth.changePassword(req.user.id, currentPassword, newPassword);
    res.json({ success: true, message: "Password changed successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SMTP ROUTES (per-user, authenticated)
// ═══════════════════════════════════════════════════════════════════════════

app.post("/api/smtp/connect", auth.requireAuth, async (req, res) => {
  try {
    const { host, port, encryption, email, password, fromName } = req.body;
    if (!host || !email || !password)
      return res.status(400).json({ error: "Host, email, and password are required" });

    const cfg = {
      host, port: parseInt(port) || 587,
      secure: encryption === "SSL",
      auth: { user: email, pass: password },
      tls: { rejectUnauthorized: false },
    };
    if (encryption === "TLS") { cfg.secure = false; cfg.requireTLS = true; }

    const transporter = nodemailer.createTransport(cfg);
    await transporter.verify();

    setUserTransporter(req.user.id, transporter);
    auth.saveUserSmtp(req.user.id, { host, port, encryption, email, password, fromName });

    console.log(`✅ SMTP [${req.user.email}]: ${email} @ ${host}:${port}`);
    res.json({ success: true, message: "SMTP connected and saved" });
  } catch (err) {
    res.status(400).json({ error: "SMTP connection failed", details: err.message, hint: smtpHint(err.message) });
  }
});

app.post("/api/smtp/disconnect", auth.requireAuth, (req, res) => {
  clearUserTransporter(req.user.id);
  auth.deleteUserSmtp(req.user.id);
  res.json({ success: true });
});

app.get("/api/smtp/status", auth.requireAuth, (req, res) => {
  const transporter = getUserTransporter(req.user.id);
  const saved = auth.getUserSmtp(req.user.id);

  // Auto-restore from DB if not in memory
  if (!transporter && saved) {
    const cfg = {
      host: saved.host, port: parseInt(saved.port) || 587,
      secure: saved.encryption === "SSL",
      auth: { user: saved.email, pass: saved.password },
      tls: { rejectUnauthorized: false },
    };
    if (saved.encryption === "TLS") { cfg.secure = false; cfg.requireTLS = true; }
    try {
      const t = nodemailer.createTransport(cfg);
      setUserTransporter(req.user.id, t);
    } catch {}
  }

  res.json({
    connected: !!getUserTransporter(req.user.id),
    saved: !!saved,
    email: saved?.email || null,
    host: saved?.host || null,
    fromName: saved?.fromName || null,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTACTS
// ═══════════════════════════════════════════════════════════════════════════

// Match valid email addresses anywhere in a string (handles comma, semicolon,
// space, slash, pipe, newline, "and", etc. as separators)
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function extractEmails(cell) {
  if (cell == null) return [];
  const matches = String(cell).match(EMAIL_REGEX) || [];
  // Dedupe + lowercase
  return [...new Set(matches.map(e => e.trim().toLowerCase()))];
}

app.post("/api/contacts/upload", auth.requireAuth, upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { defval: "" });

    if (!data.length) return res.status(400).json({ error: "File is empty" });

    const columns = Object.keys(data[0]);
    const emailCol = columns.find(c => /e.?mail/i.test(c));

    if (!emailCol)
      return res.status(400).json({
        error: 'No email column found. Add a column with "email" in the header.',
        columns,
      });

    // Expand: each row may contain multiple emails → create one contact per email
    const contacts = [];
    const seen = new Set();          // global dedupe (across the whole file)
    let rowsWithEmails = 0;
    let rowsSkipped = 0;
    let extraEmailsFound = 0;        // emails beyond the first per row

    data.forEach((row, rowIdx) => {
      const emails = extractEmails(row[emailCol]);

      if (emails.length === 0) {
        rowsSkipped++;
        return;
      }

      rowsWithEmails++;
      if (emails.length > 1) extraEmailsFound += emails.length - 1;

      emails.forEach((email, eIdx) => {
        if (seen.has(email)) return;        // skip duplicates across rows
        seen.add(email);

        // Replace the original email cell with the single extracted email
        // so {{email}} variable substitution works correctly
        contacts.push({
          _id: `c_${Date.now()}_${rowIdx}_${eIdx}`,
          ...row,
          [emailCol]: email,
        });
      });
    });

    res.json({
      success: true,
      contacts,
      columns,
      emailColumn: emailCol,
      totalRows: data.length,
      validContacts: contacts.length,
      invalidSkipped: rowsSkipped,
      extraEmailsExpanded: extraEmailsFound,
      duplicatesRemoved: rowsWithEmails + extraEmailsFound - contacts.length,
    });
  } catch (err) {
    res.status(400).json({ error: "Failed to parse file", details: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATES (per-user)
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/templates", auth.requireAuth, (req, res) => {
  res.json({ templates: auth.getUserTemplates(req.user.id) });
});

app.post("/api/templates", auth.requireAuth, (req, res) => {
  auth.saveUserTemplates(req.user.id, req.body.templates || []);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.post("/api/email/test", auth.requireAuth, async (req, res) => {
  const transporter = getUserTransporter(req.user.id);
  if (!transporter) return res.status(400).json({ error: "SMTP not connected" });

  const { to, subject, body } = req.body;
  if (!to || !subject || !body) return res.status(400).json({ error: "to / subject / body required" });

  try {
    const smtp = auth.getUserSmtp(req.user.id);
    const r = await transporter.sendMail({
      from: smtp.fromName ? `"${smtp.fromName}" <${smtp.email}>` : smtp.email,
      to, subject,
      text: body,
      html: body.replace(/\n/g, "<br>"),
    });
    res.json({ success: true, messageId: r.messageId });
  } catch (err) {
    res.status(400).json({ error: "Test email failed", details: err.message });
  }
});

app.post("/api/email/send-bulk", auth.requireAuth, async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const emit = d => res.write(`data: ${JSON.stringify(d)}\n\n`);
  const transporter = getUserTransporter(req.user.id);

  if (!transporter) { emit({ type: "error", message: "SMTP not connected" }); return res.end(); }

  const smtp = auth.getUserSmtp(req.user.id);
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
        from: smtp.fromName ? `"${smtp.fromName}" <${smtp.email}>` : smtp.email,
        to: String(to).trim(),
        subject: fill(subject, c),
        text: fill(body, c),
        html: fill(body, c).replace(/\n/g, "<br>"),
      };
      if (attachments?.length)
        opts.attachments = attachments.map(a => ({ filename: a.filename, content: a.content, encoding: "base64" }));

      const r = await transporter.sendMail(opts);
      sent++;
      emit({ type: "sent", index: i, email: to, messageId: r.messageId, sent, failed });
      console.log(`  ✉  [${req.user.email}][${i+1}/${contacts.length}] → ${to}`);
    } catch (err) {
      failed++;
      emit({ type: "failed", index: i, email: to, error: err.message, sent, failed });
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

// ─── Catch-all → frontend ────────────────────────────────────────────────
app.get("*", (_req, res) =>
  res.sendFile(path.join(__dirname, "../frontend/public/index.html"))
);

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError)
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  console.error("Server error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, HOST, () =>
  console.log(`\n🚀  JobMailer running → http://localhost:${PORT}\n`)
);
