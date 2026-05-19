from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import health, places, trips, alerts

app = FastAPI(title="IMOVE API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(places.router, prefix="/places")
app.include_router(trips.router, prefix="/trips")
app.include_router(alerts.router, prefix="/alerts")
