# 📧 JobMailer — Bulk Email Sender for Job Hunting

A complete full-stack web application for sending personalized bulk emails to companies during your job search. Upload an Excel/CSV file of contacts, customize email templates with variables, attach your resume, and send personalized emails to each contact.

---

## Features

- **SMTP Configuration** — Connect Gmail, Outlook, Yahoo, Zoho, or any custom SMTP server
- **Excel/CSV Upload** — Import contacts from `.xlsx`, `.xls`, or `.csv` files with automatic email validation
- **Email Templates** — 3 built-in job hunting templates + create your own with `{{variable}}` placeholders
- **Variable System** — Auto-fill from spreadsheet columns (name, company, position) + set global variables (yourName, skills, etc.)
- **Resume Attachment** — Attach your resume/CV to every email automatically
- **Test Emails** — Send a test email before bulk sending
- **Real-time Progress** — Server-Sent Events (SSE) for live sending progress with detailed activity log
- **Configurable Delay** — Set delay between emails to avoid spam filters (recommended: 5-15 seconds)
- **Email Validation** — Automatically skips invalid email addresses

---

## Quick Start

### 1. Install Dependencies

```bash
cd job-mailer
npm install
```

### 2. Start the Server

```bash
npm start
```

### 3. Open in Browser

Go to **http://localhost:3000**

---

## Setup Guide

### Step 1: Configure SMTP

#### Gmail (Recommended for getting started)

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable **2-Step Verification** if not already on
3. Go to [App Passwords](https://myaccount.google.com/apppasswords)
4. Generate an App Password for "Mail"
5. In JobMailer, click the **Gmail** preset and enter:
   - Email: your Gmail address
   - Password: the 16-character App Password (NOT your regular password)

#### Outlook / Office 365

1. Use the **Outlook** preset
2. Enter your Outlook email and password
3. If using MFA, generate an App Password from your Microsoft account

#### Yahoo Mail

1. Go to Yahoo Account Settings → Security
2. Generate an App Password
3. Use the **Yahoo** preset

#### Custom SMTP

Enter your SMTP host, port, and credentials manually.

### Step 2: Upload Contacts

Prepare an Excel or CSV file with these columns (column names are flexible):

| recipientName | email | company | position |
|---|---|---|---|
| Sarah Johnson | sarah@techcorp.com | TechCorp | Software Engineer |
| Michael Chen | m.chen@innovatelabs.io | Innovate Labs | Full Stack Dev |

**Required:** A column with "email" in its name.

A sample file is included: `sample-contacts.csv`

### Step 3: Choose/Create a Template

Use one of the 3 built-in templates or create your own. Use `{{columnName}}` to insert data from your spreadsheet automatically:

```
Dear {{recipientName}},

I'm writing about the {{position}} role at {{company}}...

Best regards,
{{yourName}}
```

- **Spreadsheet variables** (like `{{recipientName}}`, `{{company}}`) auto-fill from each row
- **Global variables** (like `{{yourName}}`, `{{skills}}`) are set once and apply to all emails

### Step 4: Attach Resume (Optional)

Upload your resume/CV in the Mail Setup tab. It will be attached to every email.

### Step 5: Send!

- Send a **test email** first to verify everything looks correct
- Then go to the **Send** tab and start bulk sending
- Monitor real-time progress in the activity log

---

## Project Structure

```
job-mailer/
├── backend/
│   └── server.js          # Express server with SMTP, file parsing, email sending
├── frontend/
│   └── public/
│       └── index.html     # Complete frontend (vanilla JS, no build step needed)
├── package.json
├── .env.example
├── sample-contacts.csv    # Sample contacts file for testing
└── README.md
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/smtp/connect` | Connect & verify SMTP |
| POST | `/api/smtp/disconnect` | Disconnect SMTP |
| GET | `/api/smtp/status` | Check connection status |
| POST | `/api/contacts/upload` | Upload & parse Excel/CSV |
| POST | `/api/email/test` | Send a test email |
| POST | `/api/email/send-bulk` | Bulk send with SSE progress |

---

## Tips for Job Hunting Emails

1. **Personalize** — Use variables to address each person by name and mention their company
2. **Keep it short** — 3-4 paragraphs max. Hiring managers are busy
3. **Set delays to 10-15s** — Avoid being flagged as spam
4. **Send test emails first** — Always preview before bulk sending
5. **Use a professional email** — firstname.lastname@gmail.com looks better
6. **Attach your resume** — Make it easy for them to review your qualifications
7. **Follow up** — Send a follow-up email 5-7 days later with a different template

---

## Troubleshooting

**"Authentication failed"**
- For Gmail: Make sure you're using an App Password, not your regular password
- Enable "Less Secure Apps" or use App Passwords with 2FA

**"Connection timeout"**
- Check if your network/firewall allows outbound SMTP connections
- Try a different port (587 for TLS, 465 for SSL)

**"Too many requests"**
- Increase the delay between emails
- Gmail allows ~500 emails/day; other providers may have lower limits

---

## License

MIT — Use freely for your job search. Good luck! 🎯
