# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IMOVEV2 is a multi-agent web app for public transit trip planning in Singapore (for tourists). Architecture: FastAPI backend with 4 AI agents (Planning, Adaptation, Memory, Chat) → React 18 frontend → Supabase (DB + Auth + Realtime) → Gemini 2.5 Flash LLM.

## Workflow

For every feature request, follow this sequence — each step requires user approval before proceeding:
1. **Explore** — read relevant files, understand existing patterns
2. **Plan** — write plan to `docs/plans/dev1.md` (version-controlled), await approval
3. **Code** — implement exactly the requested feature, nothing more
4. **Test** — generate and run test cases; all must pass before moving on
5. **Commit** — commit with clear message; for each changed file, state the line range(s) modified (e.g. `backend/app/agents/planning_agent.py L563-600, L614-776`) so individual changes can be cherry-picked later

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
  main.py          — FastAPI app, registers all 7 routers (health, places, trips, alerts, transit, preferences, chat) + starts APScheduler
  config.py        — Settings via pydantic_settings (reads backend/.env)
  database.py      — Supabase client (service_role key)
  routers/         — HTTP layer only; delegate all logic to agents/services
  services/        — External API clients (OneMap, LTA, Gemini, OpenWeather) + scoring (weighted mode ranking)
  agents/          — Business logic (Planning, Adaptation, Memory, Chat)
  models/          — Pydantic schemas shared across routers + agents
  data/singapore_places.json — ~50 curated Singapore POIs (static, version-controlled; loaded by planning_agent + places router)
```

**Key constraints (from PRD + IMOVE_TechStack.md):**
- 75% rule-based code, 25% LLM — Gemini only for natural-language parsing/edge cases
- Gemini rate limit: max 1 call / 4 s (≤ 15 RPM) — guard already in `services/gemini.py` (skipped in Vertex AI mode)
- Typed exceptions, never fake data — all external API failures raise typed exceptions (`NoRouteError`, `LTAUnavailableError`, `WeatherUnavailableError`); routers return explicit error responses. The non-optimize planning path *does* use instant haversine estimates, but they are explicitly flagged `is_estimated=True` so the UI never confuses them with real OneMap routes
- Render free tier hibernates after 15 min idle → `GET /health` exists for keep-alive ping

**Router → Service → Agent flow:**
- `routers/places.py` calls `services/onemap.py` directly (no agent)
- `routers/transit.py` calls `services/onemap.py` + `services/lta.py` directly (bus arrivals, route compare)
- `routers/trips.py` calls `agents/planning_agent.py`, which calls `services/onemap.py` + `services/gemini.py` + `services/scoring.py`
- `routers/alerts.py` + the APScheduler jobs call `agents/adaptation_agent.py` (mostly) and `agents/memory_agent.py` (feedback), which call `services/lta.py` + `services/openweather.py`
- `routers/preferences.py` reads/writes the weighted-scoring `UserPreferenceProfile` (Supabase `user_preferences.profile` JSONB)
- `routers/chat.py` calls `agents/chat_agent.py` (Gemini function-calling); confirmed writes are dispatched in-process to the existing `routers/trips.py` handlers (two-step propose → confirm)

### Frontend

```
frontend/src/
  App.jsx              — React Router: / → Home, /plan → Planner, /trip/:id → Trip, /settings → Settings; renders Header + ChatWidget globally
  services/api.js      — All backend calls in one place (uses VITE_API_BASE_URL) + localStorage trip helpers
  lib/supabase.js      — Supabase browser client (anon key)
  contexts/            — AuthContext (Supabase session), LanguageContext (VI/EN i18n)
  hooks/               — useTrip (fetch), useAlerts (Supabase Realtime WebSocket), useSavedTrips, useGeolocation
  pages/               — Home, Planner (multi-step wizard), Trip (list/map tabs), Settings
  components/          — planner/, map/, adaptation/, auth/, chat/, transit/, layout/, ui/
```

Realtime alerts use Supabase Postgres Changes (WebSocket), not polling — see `hooks/useAlerts.js`.

### Database (Supabase)

Migrations live in `supabase/migrations/` (001→015). Auth is only required for the Memory Agent, the Chat Agent, and `/users/me/preferences` — Planning and Adaptation work without login (guests are tracked by `session_id`). The backend also runs without Supabase via an in-memory fallback (`_trip_store`/`_trip_meta` in `routers/trips.py`) for offline demos.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **IMOVEV2** (3631 symbols, 7804 relationships, 283 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/IMOVEV2/context` | Codebase overview, check index freshness |
| `gitnexus://repo/IMOVEV2/clusters` | All functional areas |
| `gitnexus://repo/IMOVEV2/processes` | All execution flows |
| `gitnexus://repo/IMOVEV2/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
