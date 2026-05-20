# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IMOVEV2 is a multi-agent web app for public transit trip planning in Singapore (for tourists). Architecture: FastAPI backend with 3 AI agents (Planning, Adaptation, Memory) → React 18 frontend → Supabase (DB + Auth + Realtime) → Gemini 2.5 Flash LLM.

## Workflow

For every feature request, follow this sequence — each step requires user approval before proceeding:
1. **Explore** — read relevant files, understand existing patterns
2. **Plan** — write plan to `docs/plans/dev1.md` (version-controlled), await approval
3. **Code** — implement exactly the requested feature, nothing more
4. **Test** — generate and run test cases; all must pass before moving on
5. **Commit** — commit with clear message

## Commands

### Backend (Python / FastAPI)
```bash
# Install deps (run from repo root)
pip install -r backend/requirements.txt

# Run dev server (must cd into backend/ so `app.*` imports resolve)
cd backend && uvicorn app.main:app --reload

# Run all backend tests (run from backend/)
cd backend && pytest tests/ -v

# Run tests for a single service (run from backend/)
cd backend && pytest tests/test_services/test_onemap.py -v
```

> `backend/app/config.py` uses `pydantic_settings` with `env_file = ".env"` — place `.env` inside `backend/` (copy from `backend/.env.example`).

### Frontend (React / Vite)
```bash
cd frontend
npm install
npm run dev        # dev server on localhost:5173
npm run build      # production build
npm test           # vitest
```

## Architecture

### Backend

```
backend/app/
  main.py          — FastAPI app, registers all 4 routers
  config.py        — Settings via pydantic_settings (reads backend/.env)
  database.py      — Supabase client (service_role key)
  routers/         — HTTP layer only; delegate all logic to agents/services
  services/        — External API clients (OneMap, LTA, Gemini, OpenWeather)
  agents/          — Business logic (Planning, Adaptation, Memory)
  models/          — Pydantic schemas shared across routers + agents
  data/places.json — ~50 curated Singapore POIs (static, version-controlled)
```

**Key constraints (from PRD + IMOVE_TechStack.md):**
- 75% rule-based code, 25% LLM — Gemini only for natural-language parsing/edge cases
- Gemini rate limit: max 1 call / 4 s (≤ 15 RPM) — guard already in `services/gemini.py`
- No fallback estimates — all API failures raise typed exceptions (`NoRouteError`, `LTAUnavailableError`, `WeatherUnavailableError`); routers return explicit error responses
- Render free tier hibernates after 15 min idle → `GET /health` exists for keep-alive ping

**Router → Service → Agent flow:**
- `routers/places.py` calls `services/onemap.py` directly (no agent)
- `routers/trips.py` calls `agents/planning_agent.py`, which calls `services/onemap.py` + `services/gemini.py`
- `routers/alerts.py` calls `agents/adaptation_agent.py`, which calls `services/lta.py` + `services/openweather.py`

### Frontend

```
frontend/src/
  App.jsx              — React Router: / → Home, /plan → Planner, /trip/:id → Trip
  services/api.js      — All backend calls in one place (uses VITE_API_BASE_URL)
  lib/supabase.js      — Supabase browser client (anon key)
  hooks/               — useTrip (fetch), useAlerts (Supabase Realtime WebSocket)
  pages/               — Home, Planner (multi-step form), Trip (list/map tabs)
  components/          — planner/, map/, adaptation/, auth/, layout/
```

Realtime alerts use Supabase Postgres Changes (WebSocket), not polling — see `hooks/useAlerts.js`.

### Database (Supabase)

Migrations live in `supabase/migrations/`. Auth is only required for the Memory Agent — Planning and Adaptation agents work without login.

## Team Branch Ownership

| Branch | Dev | Owns |
|--------|-----|------|
| `dev/backend-infra` | Dev 1 | `backend/app/services/`, `routers/health.py`, `routers/places.py` |
| `dev/agent-logic` | Dev 2 | `backend/app/agents/`, `routers/trips.py`, `routers/alerts.py`, `data/` |
| `dev/frontend-core` | Dev 3 | `frontend/src/pages/`, `components/planner/`, `components/auth/` |
| `dev/frontend-map` | Dev 4 | `frontend/src/components/map/`, `components/adaptation/`, `hooks/`, `lib/` |
| Shared | All | `backend/app/models/`, `frontend/src/services/api.js`, `supabase/migrations/` |

Do not commit into another dev's ownership area.

## Cross-Dev Communication (Handoff Files)

Each parallel dev session communicates via handoff files in `docs/plans/`. Read the relevant file at the start of each session.

| File | For | Purpose |
|------|-----|---------|
| `docs/plans/HANDOFF_DEV2.md` | Dev 2 | API contracts, agent implementation specs, status |
| `docs/plans/HANDOFF_DEV4.md` | Dev 4 | TripMap specs, hooks verification, supabase.js |

**Protocol — every update to a handoff file MUST follow this format:**
```
Append to the "Update Log" section at the bottom of the file.
NEVER edit or delete previous entries.
Header format: ### [YYYY-MM-DD | DevX] Short description
```

When you finish a task or need to communicate a contract change, append to the handoff file immediately before committing code. The other dev's session reads this log to stay in sync.
