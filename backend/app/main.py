from fastapi import FastAPI
from app.routers import health, places, trips, alerts

app = FastAPI(title="IMOVE API")

app.include_router(health.router)
app.include_router(places.router, prefix="/places")
app.include_router(trips.router, prefix="/trips")
app.include_router(alerts.router, prefix="/alerts")
