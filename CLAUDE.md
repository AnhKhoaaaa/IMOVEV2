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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **IMOVEV2** (2730 symbols, 4733 relationships, 91 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

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
