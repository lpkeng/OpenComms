# SPDX-License-Identifier: AGPL-3.0-or-later
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Organisation(Base):
    __tablename__ = "organisations"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))

    events: Mapped[list["Event"]] = relationship(back_populates="org", cascade="all, delete-orphan")
    devices: Mapped[list["Device"]] = relationship(back_populates="org")


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organisations.id"))
    name: Mapped[str] = mapped_column(String(100))
    active: Mapped[bool] = mapped_column(Boolean, default=False)

    org: Mapped[Organisation] = relationship(back_populates="events")
    channels: Mapped[list["Channel"]] = relationship(
        back_populates="event", cascade="all, delete-orphan", order_by="Channel.position"
    )


class Channel(Base):
    __tablename__ = "channels"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(50))
    position: Mapped[int] = mapped_column(Integer, default=0)

    event: Mapped[Event] = relationship(back_populates="channels")


class ProvisionedDevice(Base):
    """Devices that can be claimed with a claim code (development stand-in for adoption).

    In production a beltpack is adopted by scanning its QR code (ID, key fingerprint and a
    one-time pairing code) from the team's dashboard. Claim codes are never sent over MQTT.
    """

    __tablename__ = "provisioned_devices"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), default="beltpack")
    claim_code: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Device(Base):
    """A device claimed by an organisation."""

    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organisations.id"))
    kind: Mapped[str] = mapped_column(String(20), default="beltpack")
    name: Mapped[str] = mapped_column(String(50), default="")
    label: Mapped[str] = mapped_column(String(50), default="")
    muted: Mapped[bool] = mapped_column(Boolean, default=False)
    disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    config_version: Mapped[int] = mapped_column(Integer, default=0)
    claimed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    org: Mapped[Organisation] = relationship(back_populates="devices")


class DeviceEventConfig(Base):
    """Per-event settings for one device (key mapping etc.)."""

    __tablename__ = "device_event_configs"
    __table_args__ = (UniqueConstraint("device_id", "event_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"))
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    # [{"key": "A", "channel_id": 1 | None, "mode": "talk" | "listen_only", "volume": 70}, ...]
    keys: Mapped[list] = mapped_column(JSON, default=list)
    ptt_channel_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    call_channel_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mic_gain_db: Mapped[int] = mapped_column(Integer, default=52)
    sidetone: Mapped[int] = mapped_column(Integer, default=20)
