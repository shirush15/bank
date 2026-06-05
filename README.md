# Bank REST API

A simple banking API built with NestJS, Prisma and PostgreSQL.

The project supports:
- Account creation
- Deposits
- Withdrawals
- Money transfers between accounts

Special attention was given to transaction consistency and preventing invalid balance updates during concurrent requests.

## Run with Docker (only Docker required)
```bash
docker compose up --build
```
Builds the API, starts PostgreSQL, applies migrations automatically, and serves on
**http://localhost:3000**. API docs: **http://localhost:3000/docs**.

Optional demo data: `docker compose exec app npm run prisma:seed`
Stop: `docker compose down` (keep data) / `docker compose down -v` (wipe).

## Run locally (DB in Docker, app with hot reload)
```bash
npm install
cp .env.example .env          # defaults point at the bundled DB
docker compose up -d db       # start PostgreSQL only
npm run prisma:generate
npm run prisma:deploy         # apply migrations
npm run start:dev
```

## Tests
```bash
npm test            # unit
npm run test:e2e    # end-to-end
```

## Architecture
The application follows the standard NestJS layered architecture:

- Controllers handle HTTP requests.
- Services contain the business logic.
- Prisma is responsible for database access.
- PostgreSQL stores accounts and transaction data.