from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import health, places, trips, alerts, transit
from app.agents import adaptation_agent

_scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _scheduler.add_job(adaptation_agent.poll_lta_alerts, "interval", minutes=2, id="lta_poll", max_instances=1)
    _scheduler.add_job(adaptation_agent.poll_weather_alerts, "interval", minutes=30, id="weather_poll", max_instances=1)
    _scheduler.start()
    yield
    _scheduler.shutdown(wait=False)


app = FastAPI(title="IMOVE API", lifespan=lifespan)

_cors_origins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
]
if settings.frontend_url:
    _cors_origins.append(settings.frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(places.router, prefix="/places")
app.include_router(trips.router, prefix="/trips")
app.include_router(alerts.router, prefix="/alerts")
app.include_router(transit.router, prefix="/transit")
