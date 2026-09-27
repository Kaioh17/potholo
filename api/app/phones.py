"""The phones a demo user can pick from.

There is no real phone to identify in the demo, so a person chooses a model and
the API derives a device id from it, in the same `<model>-<hex>` shape the
synthetic fleet uses.  A real app would send the id it generated on install and
this list would go away; nothing downstream reads it.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass


@dataclass(frozen=True)
class PhoneModel:
    slug: str
    label: str


PHONES: tuple[PhoneModel, ...] = (
    PhoneModel("pixel-8", "Google Pixel 8"),
    PhoneModel("pixel-7", "Google Pixel 7"),
    PhoneModel("pixel-6a", "Google Pixel 6a"),
    PhoneModel("galaxy-s23", "Samsung Galaxy S23"),
    PhoneModel("galaxy-a54", "Samsung Galaxy A54"),
    PhoneModel("oneplus-11", "OnePlus 11"),
    PhoneModel("moto-g", "Motorola Moto G"),
    PhoneModel("iphone-14", "Apple iPhone 14"),
)

_BY_SLUG = {phone.slug: phone for phone in PHONES}


def find_phone(slug: str) -> PhoneModel | None:
    return _BY_SLUG.get(slug)


def new_device_id(phone: PhoneModel) -> str:
    """A device id for this model, random enough that two users never share one."""
    return f"{phone.slug}-{uuid.uuid4().hex[:8]}"
