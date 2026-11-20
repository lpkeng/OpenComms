# SPDX-License-Identifier: AGPL-3.0-or-later
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .settings import KEYS

# Talk keys are always hold-to-talk (no latching), and always hear their channel too.
KeyMode = Literal["talk", "listen_only"]
Role = Literal["talk", "listen", "none"]
# reset_ptt: drop a headset PTT remap made on the beltpack and go back to the plan's channel.
Command = Literal["call", "identify", "reboot", "reset_ptt"]


class EventIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class EventCreate(EventIn):
    copy_from_event_id: int | None = None


class MembershipIn(BaseModel):
    role: Role
    # Re-patch the key currently on this channel instead of using a free key (drag between channels).
    move_from_channel_id: int | None = None


class ChannelIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class ProvisionIn(BaseModel):
    id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    kind: Literal["beltpack", "base_station"] = "beltpack"
    claim_code: str = Field(min_length=4, max_length=40)


class ClaimIn(BaseModel):
    id: str
    claim_code: str


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=50)
    label: str | None = Field(default=None, max_length=50)


class AdminUpdate(BaseModel):
    muted: bool | None = None
    disabled: bool | None = None


class KeyConfig(BaseModel):
    key: Literal["A", "B", "C", "D"]
    channel_id: int | None = None
    mode: KeyMode = "talk"
    volume: int = Field(default=70, ge=0, le=100)


class DeviceEventConfigIn(BaseModel):
    name: str | None = Field(default=None, max_length=50)
    label: str | None = Field(default=None, max_length=50)
    keys: list[KeyConfig]
    ptt_channel_id: int | None = None
    call_channel_id: int | None = None
    mic_gain_db: int = Field(default=52, ge=0, le=59)
    sidetone: int = Field(default=20, ge=0, le=100)

    @field_validator("keys")
    @classmethod
    def all_keys_once(cls, v: list[KeyConfig]) -> list[KeyConfig]:
        if sorted(k.key for k in v) != list(KEYS):
            raise ValueError("keys must contain A, B, C and D exactly once")
        return sorted(v, key=lambda k: k.key)


class CommandIn(BaseModel):
    cmd: Command
