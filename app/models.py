from pydantic import BaseModel, Field
from typing import Literal, Optional
from uuid import UUID
from datetime import datetime


class SessionCreate(BaseModel):
    name: str = Field(default="Match", max_length=60)


class SessionRename(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)


class SessionOut(BaseModel):
    id: UUID
    name: str
    created_at: datetime


class PlayerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=30)
    skill: Literal["beginner", "intermediate", "expert"]
    can_bowl: bool = False


class PlayerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=30)
    skill: Optional[Literal["beginner", "intermediate", "expert"]] = None
    can_bowl: Optional[bool] = None


class PlayerOut(BaseModel):
    id: UUID
    session_id: UUID
    name: str
    skill: Literal["beginner", "intermediate", "expert"]
    can_bowl: bool
    created_at: datetime


class TeamGenerateRequest(BaseModel):
    team_a_name: str = Field(default="Team A", max_length=40)
    team_b_name: str = Field(default="Team B", max_length=40)


class TeamAssignmentOut(BaseModel):
    player_id: UUID
    player_name: str
    skill: str
    can_bowl: bool
    team_name: str
    is_captain: bool


class TeamsOut(BaseModel):
    team_a_name: str
    team_b_name: str
    assignments: list[TeamAssignmentOut]


class AddToTeamRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=30)
    skill: Literal["beginner", "intermediate", "expert"]
    can_bowl: bool = False
    team_name: str = Field(..., max_length=40)


class TossResult(BaseModel):
    result: Literal["heads", "tails"]
    toss_number: int
    session_id: UUID


class TossHistoryItem(BaseModel):
    id: UUID
    result: Literal["heads", "tails"]
    tossed_at: datetime


class UserOut(BaseModel):
    id: str
    email: Optional[str]


class ClaimRequest(BaseModel):
    session_ids: list[str]


# ── Profile models ────────────────────────────────────────────────────────────

class TossHistorySummary(BaseModel):
    result: Literal["heads", "tails"]
    tossed_at: datetime


class MatchPlayerItem(BaseModel):
    name: str
    skill: str
    can_bowl: bool
    team_name: str
    is_captain: bool


class MatchHistoryItem(BaseModel):
    id: UUID
    name: str
    created_at: datetime
    team_a_name: Optional[str]
    team_b_name: Optional[str]
    players: list[MatchPlayerItem]
    toss_history: list[TossHistorySummary]


class PlayerStatsItem(BaseModel):
    name: str
    games: int
    as_captain: int
    as_bowler: int


class UpdateDisplayNameRequest(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=40)


class UpdateEmailRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=120)


class UpdatePasswordRequest(BaseModel):
    password: str = Field(..., min_length=6)
