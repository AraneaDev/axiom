# Getting Started

Welcome to Axiom! This guide will help you get the platform running locally.

## Prerequisites

- Node.js >= 24.0.0 (25 recommended)
- PostgreSQL 16+
- Git 2.40+

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd axiom

# Install dependencies
npm install
cd frontend && npm install && cd ..

# Set up environment
cp .env.example .env
# Edit .env with your database credentials

# Initialize the database
npm run db:push
npm run db:seed

# Start the development stack
npm run docker:dev
```

## First Steps

1. Navigate to http://localhost:7000/login
2. Log in with `tim` / `password123`
3. Explore the Axiom MVP project board
4. Browse the self-hosted repository

## Project Structure

| Directory | Purpose |
|-----------|---------|
| `src/` | Backend API server (Express + Prisma) |
| `frontend/` | React SPA (Vite + TanStack Query) |
| `prisma/` | Database schema and migrations |
| `scripts/` | Seed and utility scripts |
| `e2e/` | Playwright end-to-end tests |
