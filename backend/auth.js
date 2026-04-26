// ═══════════════════════════════════════════════════════════════════════════
// Authentication Module — SQLite + bcrypt + JWT
// ═══════════════════════════════════════════════════════════════════════════

const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");

// ─── Database setup ─────────────────────────────────────────────────────
const DB_DIR = path.join(__dirname, "../data");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, "jobmailer.db"));
db.pragma("journal_mode = WAL");

// Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT,
    verified INTEGER DEFAULT 0,
    verify_token TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_smtp (
    user_id INTEGER PRIMARY KEY,
    host TEXT, port TEXT, encryption TEXT,
    email TEXT, password TEXT, from_name TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT, subject TEXT, body TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ─── JWT secret ──────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.JWT_SECRET) {
  console.warn("⚠️  Using auto-generated JWT secret. Set JWT_SECRET env var for production.");
}

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL HELPER (for verification & password reset)
// ═══════════════════════════════════════════════════════════════════════════

function getMailer() {
  // Uses SYSTEM_SMTP_* env vars if available — for sending verification/reset emails
  const host = process.env.SYSTEM_SMTP_HOST;
  const user = process.env.SYSTEM_SMTP_USER;
  const pass = process.env.SYSTEM_SMTP_PASS;

  if (!host || !user || !pass) {
    return null; // Email sending disabled — show codes in console instead
  }

  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SYSTEM_SMTP_PORT || "587"),
    secure: process.env.SYSTEM_SMTP_SECURE === "true",
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

async function sendSystemEmail(to, subject, html) {
  const mailer = getMailer();
  if (!mailer) {
    console.log(`\n📧 [SYSTEM EMAIL — would send to ${to}]`);
    console.log(`   Subject: ${subject}`);
    console.log(`   ${html.replace(/<[^>]+>/g, "").substring(0, 200)}\n`);
    return { simulated: true };
  }
  return mailer.sendMail({
    from: process.env.SYSTEM_SMTP_FROM || process.env.SYSTEM_SMTP_USER,
    to,
    subject,
    html,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function signup(email, password, name) {
  email = email.toLowerCase().trim();

  // Validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid email format");
  }
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  // Check existing user
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) throw new Error("An account with this email already exists");

  // Hash password
  const password_hash = await bcrypt.hash(password, 10);
  const verify_token = crypto.randomBytes(32).toString("hex");

  const result = db
    .prepare("INSERT INTO users (email, password_hash, name, verify_token) VALUES (?, ?, ?, ?)")
    .run(email, password_hash, name || "", verify_token);

  // Send verification email (or log it)
  const verifyUrl = `${process.env.APP_URL || "http://localhost:3000"}/api/auth/verify?token=${verify_token}`;
  await sendSystemEmail(
    email,
    "Verify your JobMailer account",
    `<h2>Welcome to JobMailer!</h2>
     <p>Hi ${name || "there"},</p>
     <p>Click the link below to verify your email and activate your account:</p>
     <p><a href="${verifyUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px">Verify My Email</a></p>
     <p>Or copy this link: ${verifyUrl}</p>
     <p>If you didn't create this account, you can safely ignore this email.</p>`
  );

  return { id: result.lastInsertRowid, email, name, verified: false };
}

async function login(email, password) {
  email = email.toLowerCase().trim();
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) throw new Error("Invalid email or password");

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new Error("Invalid email or password");

  const token = jwt.sign(
    { userId: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: "30d" }
  );

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      verified: !!user.verified,
    },
  };
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function getUserById(id) {
  const user = db.prepare("SELECT id, email, name, verified FROM users WHERE id = ?").get(id);
  if (user) user.verified = !!user.verified;
  return user;
}

function verifyEmail(token) {
  const user = db.prepare("SELECT id FROM users WHERE verify_token = ?").get(token);
  if (!user) return false;
  db.prepare("UPDATE users SET verified = 1, verify_token = NULL WHERE id = ?").run(user.id);
  return true;
}

async function requestPasswordReset(email) {
  email = email.toLowerCase().trim();
  const user = db.prepare("SELECT id, name FROM users WHERE email = ?").get(email);

  // Always return success (don't leak whether email exists)
  if (!user) return { sent: true };

  const token = crypto.randomBytes(32).toString("hex");
  const expires_at = Math.floor(Date.now() / 1000) + 3600; // 1 hour

  db.prepare("INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)")
    .run(user.id, token, expires_at);

  const resetUrl = `${process.env.APP_URL || "http://localhost:3000"}/?reset=${token}`;
  await sendSystemEmail(
    email,
    "Reset your JobMailer password",
    `<h2>Password Reset Request</h2>
     <p>Hi ${user.name || "there"},</p>
     <p>You requested to reset your password. Click the link below:</p>
     <p><a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px">Reset My Password</a></p>
     <p>Or copy this link: ${resetUrl}</p>
     <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`
  );

  return { sent: true };
}

async function resetPassword(token, newPassword) {
  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");

  const reset = db.prepare(
    "SELECT * FROM reset_tokens WHERE token = ? AND used = 0 AND expires_at > ?"
  ).get(token, Math.floor(Date.now() / 1000));

  if (!reset) throw new Error("Invalid or expired reset link");

  const password_hash = await bcrypt.hash(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(password_hash, reset.user_id);
  db.prepare("UPDATE reset_tokens SET used = 1 WHERE id = ?").run(reset.id);

  return { success: true };
}

async function changePassword(userId, currentPassword, newPassword) {
  if (newPassword.length < 8) throw new Error("New password must be at least 8 characters");

  const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId);
  if (!user) throw new Error("User not found");

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) throw new Error("Current password is incorrect");

  const password_hash = await bcrypt.hash(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(password_hash, userId);

  return { success: true };
}

// ─── Express middleware ─────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies?.auth_token || req.headers.authorization?.replace("Bearer ", "");

  if (!token) return res.status(401).json({ error: "Not authenticated" });

  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: "Invalid or expired session" });

  const user = getUserById(decoded.userId);
  if (!user) return res.status(401).json({ error: "User not found" });

  req.user = user;
  next();
}

// ─── User-scoped data helpers ────────────────────────────────────────────
function saveUserSmtp(userId, smtp) {
  db.prepare(`INSERT OR REPLACE INTO user_smtp
    (user_id, host, port, encryption, email, password, from_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    userId, smtp.host, smtp.port, smtp.encryption,
    smtp.email, smtp.password, smtp.fromName || ""
  );
}

function getUserSmtp(userId) {
  const row = db.prepare("SELECT * FROM user_smtp WHERE user_id = ?").get(userId);
  if (!row) return null;
  return {
    host: row.host, port: row.port, encryption: row.encryption,
    email: row.email, password: row.password, fromName: row.from_name,
  };
}

function deleteUserSmtp(userId) {
  db.prepare("DELETE FROM user_smtp WHERE user_id = ?").run(userId);
}

function saveUserTemplates(userId, templates) {
  db.prepare("DELETE FROM user_templates WHERE user_id = ?").run(userId);
  const stmt = db.prepare(
    "INSERT INTO user_templates (user_id, name, subject, body) VALUES (?, ?, ?, ?)"
  );
  templates.forEach(t => stmt.run(userId, t.name, t.subject, t.body));
}

function getUserTemplates(userId) {
  const rows = db.prepare(
    "SELECT id, name, subject, body FROM user_templates WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId);
  return rows.map(r => ({ id: `t${r.id}`, name: r.name, subject: r.subject, body: r.body }));
}

module.exports = {
  signup, login, verifyEmail,
  requestPasswordReset, resetPassword, changePassword,
  requireAuth, verifyToken, getUserById,
  saveUserSmtp, getUserSmtp, deleteUserSmtp,
  saveUserTemplates, getUserTemplates,
};
