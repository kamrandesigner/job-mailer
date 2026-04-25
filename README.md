# 📧 JobMailer — Bulk Email Sender with Authentication

A complete full-stack web application with user accounts, login/signup, password reset, and bulk email sending for job hunting.

---

## ✨ Features

### Authentication
- **Sign up / Log in** — Secure user accounts with bcrypt password hashing
- **Forgot Password** — Email-based password reset with secure tokens
- **Email Verification** — Verify accounts via email link
- **Change Password** — Update password from account settings
- **Persistent Sessions** — Stay logged in for 30 days (HTTP-only cookies)
- **Per-user data** — Each user has their own SMTP config, templates, and contacts

### Email Sending
- **SMTP Configuration** — Gmail, Outlook, Yahoo, Zoho presets + custom SMTP
- **Excel/CSV Upload** — Import contacts with email validation
- **Email Templates** — Built-in templates + custom ones with `{{variable}}` placeholders
- **Variable System** — Auto-fill from spreadsheet + global variables
- **Resume Attachments** — Attach files to every email
- **Test Emails** — Preview before bulk sending
- **Real-time Progress** — Live activity log via Server-Sent Events
- **Configurable Delays** — Avoid spam filters

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. (Optional) Configure System Email
Copy `.env.example` to `.env` and set up:
- `JWT_SECRET` — random string for session security
- `SYSTEM_SMTP_*` — SMTP credentials for sending verification/reset emails

> Without SYSTEM_SMTP, verification & reset links are **logged to the console** (still works!).

### 3. Start the Server
```bash
npm start
```

### 4. Open the App
Go to **http://localhost:3000**

Create an account → log in → connect your email SMTP → upload contacts → send!

---

## 📦 Deployment

### Railway / Render / Back4app
1. Push this repo to GitHub
2. Connect to your hosting platform
3. Set these environment variables:
   - `JWT_SECRET` (generate: `openssl rand -hex 32`)
   - `NODE_ENV=production`
   - `APP_URL=https://your-app-url.com`
   - (Optional) `SYSTEM_SMTP_*` for password reset emails

The included `Dockerfile`, `railway.json`, and `render.yaml` work out of the box.

---

## 🗄️ Database

Uses **SQLite** stored in `data/jobmailer.db`. No setup needed — created automatically on first run.

**Tables:**
- `users` — accounts (email, hashed password, verification status)
- `reset_tokens` — temporary password reset tokens
- `user_smtp` — saved SMTP credentials per user
- `user_templates` — saved email templates per user

---

## 🔒 Security

- ✅ Passwords hashed with **bcrypt** (10 rounds)
- ✅ Sessions via **JWT** in HTTP-only cookies
- ✅ Password reset tokens expire after 1 hour, single-use
- ✅ Email enumeration prevention (forgot-password always returns success)
- ✅ Per-user data isolation
- ✅ All user routes require authentication
- ✅ Input validation on all endpoints

---

## 📡 API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Create account |
| POST | `/api/auth/login` | Log in |
| POST | `/api/auth/logout` | Log out |
| GET | `/api/auth/me` | Get current user |
| GET | `/api/auth/verify?token=` | Verify email |
| POST | `/api/auth/forgot-password` | Request reset |
| POST | `/api/auth/reset-password` | Reset with token |
| POST | `/api/auth/change-password` | Change password |

### App (all require auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/smtp/connect` | Save & verify SMTP |
| GET | `/api/smtp/status` | Check SMTP connection |
| POST | `/api/smtp/disconnect` | Remove SMTP |
| POST | `/api/contacts/upload` | Upload Excel/CSV |
| GET | `/api/templates` | Get user templates |
| POST | `/api/templates` | Save user templates |
| POST | `/api/email/test` | Send test email |
| POST | `/api/email/send-bulk` | Bulk send (SSE progress) |

---

## 📁 Project Structure

```
job-mailer/
├── backend/
│   ├── server.js          # Express server
│   └── auth.js            # Auth + database logic
├── frontend/
│   └── public/
│       └── index.html     # Single-file frontend (auth + app)
├── data/                  # SQLite database (auto-created)
├── Dockerfile
├── package.json
├── .env.example
├── railway.json
├── render.yaml
└── README.md
```

---

## 💡 Tips

- **Gmail App Password:** Required for sending. Get one at myaccount.google.com/apppasswords
- **Email delay:** Set 10-15 seconds for safety. Gmail limits ~500/day
- **Test first:** Always send yourself a test before bulk
- **Personalize:** Use spreadsheet columns like `{{recipientName}}`, `{{company}}` in templates

---

## License
MIT — Use freely for your job search. Good luck! 🎯
