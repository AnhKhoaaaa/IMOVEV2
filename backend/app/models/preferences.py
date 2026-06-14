from __future__ import annotations

from datetime import datetime
from typing import Literal

import zoneinfo

from pydantic import BaseModel, Field, model_validator


class ModeConstraints(BaseModel):
    avoid_bus:        bool = False
    avoid_metro:      bool = False
    minimize_walking: bool = False   # boost walking_w +0.15 khi tính điểm
    minimize_fee:     bool = False   # boost cost_w    +0.15 khi tính điểm
    avoid_transfers:  bool = False   # penalise routes with >1 transfer in score_alternatives


class UserPreferenceProfile(BaseModel):
    """Profile lưu vào Supabase user_preferences.profile (JSONB).

    Weights phải sum = 1.0 (±0.01 tolerance). Default: ưu tiên nhanh nhất.
    """
    duration_w:  float = Field(default=0.40, ge=0.0, le=1.0)
    cost_w:      float = Field(default=0.30, ge=0.0, le=1.0)
    walking_w:   float = Field(default=0.20, ge=0.0, le=1.0)
    transfers_w: float = Field(default=0.10, ge=0.0, le=1.0)
    constraints: ModeConstraints = Field(default_factory=ModeConstraints)

    @model_validator(mode="after")
    def weights_must_sum_to_one(self) -> "UserPreferenceProfile":
        total = self.duration_w + self.cost_w + self.walking_w + self.transfers_w
        if abs(total - 1.0) > 0.01:
            raise ValueError(f"Weights must sum to 1.0, got {total:.4f}")
        return self

    def renormalized(self) -> "UserPreferenceProfile":
        """Trả về bản copy với weights re-normalize về sum = 1.0 chính xác.

        Rounding each weight to 4 dp independently can leave the sum at e.g.
        0.9999 (thirds), which fails the DB CHECK ROUND(sum, 4) = 1.0000.
        Absorb the residual into the largest weight so the four always total
        exactly 1.0000.
        """
        total = self.duration_w + self.cost_w + self.walking_w + self.transfers_w
        if total == 0:
            return UserPreferenceProfile()
        rounded = {
            "duration_w":  round(self.duration_w  / total, 4),
            "cost_w":      round(self.cost_w      / total, 4),
            "walking_w":   round(self.walking_w   / total, 4),
            "transfers_w": round(self.transfers_w / total, 4),
        }
        residual = round(1.0 - sum(rounded.values()), 4)
        if residual:
            top = max(rounded, key=rounded.get)
            rounded[top] = round(rounded[top] + residual, 4)
        return self.model_copy(update=rounded)


_SGT = zoneinfo.ZoneInfo("Asia/Singapore")


class ContextSnapshot(BaseModel):
    """Context thực tế tại thời điểm recommend. KHÔNG lưu DB."""
    rain_mm_per_hour:     float = Field(default=0.0, ge=0.0)
    current_time_minutes: int   = Field(default=0, ge=0, le=1439)

    @property
    def is_peak_hours(self) -> bool:
        """Singapore MRT peak: 7:30–9:30 và 17:00–20:00 SGT."""
        t = self.current_time_minutes
        return (450 <= t <= 570) or (1020 <= t <= 1200)

    @property
    def rain_level(self) -> Literal["none", "light", "heavy"]:
        if self.rain_mm_per_hour >= 7.5:
            return "heavy"
        if self.rain_mm_per_hour >= 2.5:
            return "light"
        return "none"

    @classmethod
    def now(cls, rain_mm: float = 0.0) -> "ContextSnapshot":
        """Factory: tạo ContextSnapshot với thời gian SGT hiện tại."""
        now_sgt = datetime.now(_SGT)
        return cls(
            rain_mm_per_hour=rain_mm,
            current_time_minutes=now_sgt.hour * 60 + now_sgt.minute,
        )


class ModeScore(BaseModel):
    mode:             str
    score:            float
    duration_minutes: int
    cost_sgd:         float
    walk_minutes:     int
    num_transfers:    int
    is_recommended:   bool = False


class ScoringResult(BaseModel):
    ranked:           list[ModeScore]
    recommended_mode: str
    context_applied:  bool = False
    reasoning:        str  = ""
