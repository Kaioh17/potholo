"""Join the demo with a name and a phone, and see what that phone found.

There is no login: the user id returned by `POST /v1/users/join` is the only
handle, and the web app keeps it in the browser.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from app import users
from app.database import SessionDep
from app.phones import PHONES
from app.schemas import JoinRequest, PhoneOut, UserOut, UserView

router = APIRouter(prefix="/v1", tags=["users"])


@router.get("/phones", response_model=list[PhoneOut])
def phones() -> list[PhoneOut]:
    """The phone models a demo user can pick from."""
    return [PhoneOut(slug=p.slug, label=p.label) for p in PHONES]


@router.post("/users/join", response_model=UserOut, status_code=201)
def join(body: JoinRequest, session: SessionDep) -> UserOut:
    """Create a user and the device id their simulated phone will upload under."""
    try:
        user = users.join(session, body)
    except users.NameTakenError:
        raise HTTPException(409, "That name is taken. Try another.") from None
    return users.to_out(user)


@router.get("/users/{user_id}", response_model=UserView)
def user(user_id: uuid.UUID, session: SessionDep) -> UserView:
    """A user, with the upload health and detections of their phone."""
    found = users.get_user(session, user_id)
    if found is None:
        raise HTTPException(404, "unknown user")
    return users.to_view(session, found)
