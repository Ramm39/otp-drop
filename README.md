# OTP Drop

Temporary inbox UI for catching one-time passcodes. Hosted on Netlify.

## What it does

- Creates a disposable inbox via [mail.tm](https://mail.tm/)
- Polls for incoming mail and surfaces detected OTP codes
- Includes a **Send test OTP** Netlify Function so you can verify the UI without an external sender

## Local development

```bash
npm install
npx netlify dev
```

Open the URL Netlify prints (usually `http://localhost:8888`).

## Deploy

```bash
npm run build
npx netlify deploy --prod
```

## Note

This is **not** mailcow. A full mail server needs a VPS, Docker, and DNS (MX/SPF/DKIM). OTP Drop is a lightweight Netlify front end for temporary inboxes and OTP demos.
