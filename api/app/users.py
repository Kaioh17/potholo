"""Joining the demo, and looking a user up.

A user is a name plus a device id.  The uniqueness rule lives here so every
caller gets the same answer; the database's unique index backs it up for two
joins that arrive at once.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.devices import as_utc, device_out, device_rows
from app.models.user import User
from app.phones import PhoneModel, find_phone, new_device_id
from app.schemas import JoinRequest, PhoneOut, UserOut, UserView


class NameTakenError(Exception):
    """Somebody with this name (in any letter case) has already joined."""


def name_key(name: str) -> str:
    return name.casefold()


def join(session: Session, request: JoinRequest) -> User:
    key = name_key(request.name)
    if session.scalar(select(User.id).where(User.name_key == key)) is not None:
        raise NameTakenError(request.name)
    phone = find_phone(request.phone)
    assert phone is not None  # JoinRequest only lets catalogue models through
    user = User(
        name=request.name,
        name_key=key,
        phone_model=phone.slug,
        device_id=new_device_id(phone),
    )
    session.add(user)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise NameTakenError(request.name) from None
    return user


def get_user(session: Session, user_id: uuid.UUID) -> User | None:
    return session.get(User, user_id)


def to_out(user: User) -> UserOut:
    phone = find_phone(user.phone_model) or PhoneModel(
        user.phone_model, user.phone_model
    )
    return UserOut(
        user_id=str(user.id),
        name=user.name,
        phone=PhoneOut(slug=phone.slug, label=phone.label),
        device_id=user.device_id,
        joined=as_utc(user.created_at),
    )


def to_view(session: Session, user: User) -> UserView:
    rows = device_rows(session, user.device_id)
    return UserView(
        **to_out(user).model_dump(),
        device=device_out(rows[0]) if rows else None,
    )
