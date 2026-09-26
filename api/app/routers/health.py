from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.database import SessionDep

router = APIRouter(prefix="/health", tags=["health"])


class Health(BaseModel):
    status: str


@router.get("")
def read_health(session: SessionDep) -> Health:
    session.execute(text("SELECT 1"))
    return Health(status="ok")
