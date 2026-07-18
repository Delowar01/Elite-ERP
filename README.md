# Elite ERP

Multi-tenant SaaS ERP for Elite Innovation Solutions — sales documents, purchasing, accounting/ledger, banking, HR/payroll, and projects, with Saudi Arabia (ZATCA) e-invoicing fields on invoices.

Next.js (App Router) full-stack app, PostgreSQL via Drizzle ORM, custom JWT-cookie auth. No external services required to run it — everything (including this README's setup) is self-contained and portable to any server that can run Node.js and Postgres.

## Prerequisites

- Node.js 20 or later
- PostgreSQL 16 or later

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a database and a role for the app (adjust names/password as you like):

   ```bash
   sudo -u postgres psql -c "CREATE ROLE erp_app WITH LOGIN PASSWORD 'choose-a-strong-password';"
   sudo -u postgres psql -c "CREATE DATABASE elite_erp OWNER erp_app;"
   ```

3. Copy the env template and fill it in:

   ```bash
   cp .env.example .env
   ```

   - `DATABASE_URL` — point this at the database you just created, e.g. `postgresql://erp_app:choose-a-strong-password@localhost:5432/elite_erp`.
   - `AUTH_SECRET` — **required.** The app refuses to start (and every request fails) if it's unset — there is no insecure fallback. Generate a fresh one, don't reuse any value that shipped in this repo's history:

     ```bash
     openssl rand -hex 32
     ```

     Changing `AUTH_SECRET` later invalidates every existing session (all users get logged out) — expected the first time you deploy, worth knowing if you ever rotate it afterward.

   Uploaded branding (logos, seals, signatures) is stored under an `uploads/` directory in the project root (gitignored) and served through an authenticated, org-scoped route — keep that directory writable and persistent across deploys, or move it to object storage for a multi-instance setup.

4. Push the schema to your database:

   ```bash
   npm run db:push
   ```

   (`db:generate` and `db:studio` are also available if you want versioned migration files or a DB browser UI — day-to-day setup only needs `db:push`.)

5. Build and start:

   ```bash
   npm run build
   npm start
   ```

   The app listens on port 3000 by default (`PORT=3000` env var to change it).

6. Visit `/register` in your browser. The first person to register creates the organization and becomes its owner — there's no separate seed script to run; chart of accounts, document numbering, and starter presets are seeded automatically for every new organization.

## Running in production

Keep the Node process alive and restart it on crash/reboot with a process manager. Either of these works:

**pm2**

```bash
npm install -g pm2
pm2 start npm --name elite-erp -- start
pm2 save
pm2 startup
```

**systemd** — `/etc/systemd/system/elite-erp.service`:

```ini
[Unit]
Description=Elite ERP
After=network.target postgresql.service

[Service]
WorkingDirectory=/path/to/elite-erp
ExecStart=/usr/bin/npm start
Restart=always
User=www-data
EnvironmentFile=/path/to/elite-erp/.env

[Install]
WantedBy=multi-user.target
```

Then `systemctl enable --now elite-erp`.

Put a reverse proxy in front of it for TLS and a normal domain. Nginx example:

```nginx
server {
    listen 80;
    server_name erp.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

(Add TLS with certbot/Let's Encrypt or your own certificates as usual.)

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4
- PostgreSQL + Drizzle ORM
- Custom JWT-cookie auth (bcryptjs + jose) — no third-party auth provider
- Server Components for reads, Server Actions for mutations
