from fastapi import APIRouter
from fx_service import get_all_fx_rates

router = APIRouter()

@router.get("/fx-rates")
def get_fx_rates():
    return get_all_fx_rates()
