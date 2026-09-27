"""A person who joined the demo.

The only thing a user gives us is a name and the model of phone they pretend to
have.  The device id is generated from that model, and is the key that ties the
person to the readings their simulated phone uploads.
"""

from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    name: Mapped[str] = mapped_column(String(40))
    # Lower-cased name, so "Ada" and "ada" cannot both join.  The unique index is
    # what actually stops two simultaneous joins; the service check is for a
    # friendly error.
    name_key: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    phone_model: Mapped[str] = mapped_column(String(64))
    device_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
