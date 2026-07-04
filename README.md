# TinyBit Server

Backend API for **TinyBit / DD Medax** (elderly health companion).

- **Node 20+** · Express · MySQL · JWT + Firebase · S3 presigned media · Swagger
- **Mobile app** → `/api/*`
- **Admin panel** → `/admin` and `/admin/api/*`

## Documentation

**Read [`CLAUDE.md`](./CLAUDE.md)** — full architecture, API map, database tables, S3 flow, env vars, completed vs pending work. Intended as the single lookup guide for this repo.

## Quick start

```bash
cp .env.example .env
npm ci
npm run dev
```

- Health: `GET /api/health`
- API docs: `GET /api/docs`

## Deploy (EC2)

```bash
git pull && npm ci --omit=dev && pm2 restart tinybit-api
```
