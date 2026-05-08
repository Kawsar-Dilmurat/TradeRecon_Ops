import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from database import init_db
from routes.health import router as health_router
from routes.upload import router as upload_router
from routes.reconcile import router as reconcile_router
from routes.dashboard import router as dashboard_router
from routes.results import router as results_router
from routes.ai_routes import router as ai_router
from routes.reports import router as reports_router
from routes.fx import router as fx_router
from routes.demo import router as demo_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        init_db()
    except Exception as e:
        print(f"Warning: DB init failed: {e}")
    yield


app = FastAPI(title="TradeReconOps API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/api")
app.include_router(upload_router, prefix="/api/upload")
app.include_router(reconcile_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")
app.include_router(results_router, prefix="/api")
app.include_router(ai_router, prefix="/api/ai")
app.include_router(reports_router, prefix="/api/reports")
app.include_router(fx_router, prefix="/api")
app.include_router(demo_router, prefix="/api/demo")
