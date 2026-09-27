from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app import geocoding

router = APIRouter(prefix="/v1/geocode", tags=["geocode"])


class AddressOut(BaseModel):
    label: str
    road: str | None
    house_number: str | None
    area: str | None
    city: str | None
    postcode: str | None
    cached: bool
    attribution: str = geocoding.ATTRIBUTION


@router.get("/reverse")
def reverse(
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
) -> AddressOut:
    """The street address nearest a coordinate, for labelling a pothole."""
    try:
        address, cached = geocoding.reverse(lat, lon)
    except geocoding.NoAddress as exc:
        raise HTTPException(404, "No address known at this location") from exc
    except geocoding.GeocodeUnavailable as exc:
        raise HTTPException(502, "The address lookup service is unavailable") from exc
    return AddressOut(**address.__dict__, cached=cached)
