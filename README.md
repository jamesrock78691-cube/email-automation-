# EMAIL AUTOMATION DASHBOARD V1

A premium, production-level, state-of-the-art Next.js (App Router) full-stack web application designed for enterprise email outreach, rotation, and high-fidelity open tracking. 

## Features & Modules

- **Gmail & SMTP Rotation Flow**: Automatically rotates through healthy, priority-sorted Gmail/SMTP accounts. Built-in daily and minute rate-limiting, failed account skipping, progressive cool-down windows, and automatic status updates.
- **Queue & Background Worker System**: An integrated manual or auto-run daemon that compiles templates with variables, appends attachments, injects trackers, and dispatches.
- **Interactive Google Sheets Simulator**: An Excel-style raw data importer directly inside the dashboard with standard column headers for zero-setup migrations.
- **HTML Templates Studio**: Real-time code compiler supporting variables (`{{reference_no}}`, `{{serial_no}}`, `{{mark_name}}`, `{{filing_date}}`, `{{email}}`, etc.) and side-by-side renders.
- **Live Open Tracking Pixel**: An endpoint (`/api/track/[trackingId]`) serving a transparent 1x1 tracking PNG. Logs recipient browser types, device categories, IP addresses, and country-level indicators.
- **Modern Tech Stack**: Built with **Next.js (App Router)**, **Tailwind CSS**, and **PostgreSQL via Drizzle ORM**.

## Folder Structure

```
src/
├── app/
│   ├── api/
│   │   ├── campaign/
│   │   ├── dashboard/
│   │   ├── gmail/
│   │   ├── queue/
│   │   ├── template/
│   │   └── track/
│   │       └── [trackingId]/
│   │   services/
│   │       └── emailSender.ts
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── db/
│   ├── index.ts
│   ├── schema.ts
│   └── seed.ts
```

## Setup & Running

1. **Bootstrap & Seed**: The application includes automatic seeding. Upon your first visit, the database is auto-seeded with default admin users, premium templates, and sample rotating Gmail accounts.
2. **Execute build**:
   ```bash
   npm run build
   ```
3. **Start Production Server**:
   ```bash
   npm run start
   ```
