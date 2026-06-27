from pydantic import BaseModel, Field
from typing import Literal, Optional, Any
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
    bowl_type: Literal["legal", "throw"] = "legal"


class PlayerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=30)
    skill: Optional[Literal["beginner", "intermediate", "expert"]] = None
    can_bowl: Optional[bool] = None
    bowl_type: Optional[Literal["legal", "throw"]] = None


class PlayerOut(BaseModel):
    id: UUID
    session_id: UUID
    name: str
    skill: Literal["beginner", "intermediate", "expert"]
    can_bowl: bool
    bowl_type: Literal["legal", "throw"]
    created_at: datetime


class TeamGenerateRequest(BaseModel):
    team_a_name: str = Field(default="Team A", max_length=40)
    team_b_name: str = Field(default="Team B", max_length=40)


class TeamAssignmentOut(BaseModel):
    player_id: UUID
    player_name: str
    skill: str
    can_bowl: bool
    bowl_type: Literal["legal", "throw"] = "legal"
    team_name: str
    is_captain: bool


class TeamsOut(BaseModel):
    team_a_name: str
    team_b_name: str
    assignments: list[TeamAssignmentOut]


class TeamManualAssignment(BaseModel):
    player_id: str
    team_name: str


class TeamManualEditRequest(BaseModel):
    team_a_name: str = Field(..., max_length=40)
    team_b_name: str = Field(..., max_length=40)
    assignments: list[TeamManualAssignment]
    captain_a_id: Optional[str] = None  # explicit captain for team A; falls back to preserve/random
    captain_b_id: Optional[str] = None  # explicit captain for team B


class AddToTeamRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=30)
    skill: Literal["beginner", "intermediate", "expert"]
    can_bowl: bool = False
    bowl_type: Literal["legal", "throw"] = "legal"
    team_name: str = Field(..., max_length=40)


class TossResult(BaseModel):
    id: UUID
    result: Literal["heads", "tails"]
    toss_number: int
    session_id: UUID
    winner_team: Optional[str] = None
    elected_to: Optional[Literal["bat", "field"]] = None


class TossDecisionUpdate(BaseModel):
    winner_team: str = Field(..., min_length=1, max_length=40)
    elected_to: Literal["bat", "field"]


class TossHistoryItem(BaseModel):
    id: UUID
    result: Literal["heads", "tails"]
    tossed_at: datetime
    winner_team: Optional[str] = None
    elected_to: Optional[Literal["bat", "field"]] = None


class UserOut(BaseModel):
    id: str
    email: Optional[str]


class ClaimRequest(BaseModel):
    session_ids: list[str]


# ── Profile models ────────────────────────────────────────────────────────────

class TossHistorySummary(BaseModel):
    result: Literal["heads", "tails"]
    tossed_at: datetime
    winner_team: Optional[str] = None
    elected_to: Optional[Literal["bat", "field"]] = None


class MatchPlayerItem(BaseModel):
    name: str
    skill: str
    can_bowl: bool
    team_name: str
    is_captain: bool


class InningsSummaryItem(BaseModel):
    innings_number: int
    batting_team: str
    bowling_team: str
    runs: int
    wickets: int
    overs_str: str
    status: str


class MatchSummaryItem(BaseModel):
    id: UUID
    name: Optional[str]
    status: str
    created_at: datetime
    innings_list: list[InningsSummaryItem]


class MatchHistoryItem(BaseModel):
    id: UUID
    name: str
    created_at: datetime
    team_a_name: Optional[str]
    team_b_name: Optional[str]
    players: list[MatchPlayerItem]
    toss_history: list[TossHistorySummary]
    matches: list[MatchSummaryItem] = []


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


# ── Scorekeeping models ───────────────────────────────────────────────────────

# Rules presets and config
class MatchRules(BaseModel):
    # Wide ball
    wide_runs: int = 1
    wide_counts_as_ball: bool = False
    wide_reball: bool = True
    # No ball
    no_ball_runs: int = 1
    no_ball_counts_as_ball: bool = False
    no_ball_reball: bool = True
    # Free hit (after no ball)
    free_hit_enabled: bool = True
    free_hit_dismissals: Literal["none", "run_out", "run_out_stumping", "all"] = "run_out"
    # Wicket types allowed
    wicket_types: list[str] = ["bowled", "caught", "run_out", "lbw", "stumped", "hit_wicket"]
    # Last-man standing
    last_man_standing: bool = False
    # Retirement
    retirement_runs: Optional[int] = None  # None = disabled
    # Boundary values
    boundary_four: int = 4
    boundary_six: int = 6
    # Bowling caps (team-linked matches only; None = no cap)
    max_overs_per_bowler: Optional[int] = None
    max_throw_overs_per_team: Optional[int] = None


RULES_PRESETS: dict[str, dict] = {
    "standard": {
        "wide_runs": 1, "wide_counts_as_ball": False, "wide_reball": True,
        "no_ball_runs": 1, "no_ball_counts_as_ball": False, "no_ball_reball": True,
        "free_hit_enabled": True, "free_hit_dismissals": "run_out",
        "wicket_types": ["bowled", "caught", "run_out", "lbw", "stumped", "hit_wicket"],
        "last_man_standing": False, "retirement_runs": None,
        "boundary_four": 4, "boundary_six": 6,
    },
    "box": {
        "wide_runs": 1, "wide_counts_as_ball": True, "wide_reball": False,
        "no_ball_runs": 1, "no_ball_counts_as_ball": True, "no_ball_reball": False,
        "free_hit_enabled": False, "free_hit_dismissals": "none",
        "wicket_types": ["bowled", "caught", "run_out", "stumped"],
        "last_man_standing": False, "retirement_runs": None,
        "boundary_four": 4, "boundary_six": 6,
    },
    "gully": {
        "wide_runs": 1, "wide_counts_as_ball": False, "wide_reball": True,
        "no_ball_runs": 1, "no_ball_counts_as_ball": False, "no_ball_reball": True,
        "free_hit_enabled": False, "free_hit_dismissals": "none",
        "wicket_types": ["bowled", "caught", "run_out"],
        "last_man_standing": True, "retirement_runs": None,
        "boundary_four": 4, "boundary_six": 6,
    },
}


class MatchCreate(BaseModel):
    session_id: Optional[str] = None
    match_type: Literal["quick", "team"] = "quick"
    overs: int = Field(default=6, ge=1, le=50)
    players_per_side: int = Field(default=6, ge=2, le=11)
    rules_preset: Literal["standard", "box", "gully", "custom"] = "standard"
    rules: Optional[MatchRules] = None  # custom override
    name: Optional[str] = Field(default=None, max_length=100)


class MatchOut(BaseModel):
    id: UUID
    session_id: Optional[UUID]
    match_type: str
    status: str
    overs: int
    players_per_side: int
    rules_preset: str
    watch_code: Optional[str] = None
    name: Optional[str] = None
    created_at: datetime


class InningsCreate(BaseModel):
    batting_team: str = Field(..., min_length=1, max_length=40)
    bowling_team: str = Field(..., min_length=1, max_length=40)
    opening_striker_id: Optional[str] = None
    opening_non_striker_id: Optional[str] = None


class InningsOut(BaseModel):
    id: UUID
    match_id: UUID
    innings_number: int
    batting_team: str
    bowling_team: str
    target: Optional[int]
    status: str
    created_at: datetime
    opening_striker_id: Optional[UUID] = None
    opening_non_striker_id: Optional[UUID] = None


class OverAssignmentCreate(BaseModel):
    bowler_id: str
    bowl_type: Literal["legal", "throw"] = "legal"


class OverAssignmentOut(BaseModel):
    id: UUID
    innings_id: UUID
    over_number: int
    bowler_id: Optional[UUID]
    bowl_type: Literal["legal", "throw"]
    created_at: datetime


class BatterStats(BaseModel):
    player_id: UUID
    name: str
    runs: int
    balls: int
    fours: int
    sixes: int
    strike_rate: float
    status: Literal["batting", "out", "not_out"]
    dismissal: Optional[str] = None


class BowlerStats(BaseModel):
    player_id: UUID
    name: str
    overs: int          # completed overs
    balls_legal: int    # legal balls in the current (incomplete) over
    runs_conceded: int
    wickets: int
    economy: float
    bowl_type: Literal["legal", "throw"]  # predominant type this innings
    legal_overs: int
    throw_overs: int


EventType = Literal["dot", "runs", "wide", "no_ball", "bye", "leg_bye", "wicket", "dead_ball", "penalty"]
BoundaryType = Literal["four", "six"]
WicketType = Literal["bowled", "caught", "run_out", "lbw", "stumped", "hit_wicket"]


class BallEventCreate(BaseModel):
    event_type: EventType
    runs: int = Field(default=0, ge=0, le=36)
    extra_type: Optional[Literal["wide", "no_ball", "bye", "leg_bye"]] = None
    is_boundary: bool = False
    boundary_type: Optional[BoundaryType] = None
    wicket_type: Optional[WicketType] = None
    batter_id: Optional[str] = None
    bowler_id: Optional[str] = None
    metadata: dict[str, Any] = {}


class BallEventOut(BaseModel):
    id: UUID
    innings_id: UUID
    over_number: int
    ball_number: int
    event_type: str
    runs: int
    extras: int
    extra_type: Optional[str]
    is_legal_ball: bool
    is_boundary: bool
    boundary_type: Optional[str]
    wicket_type: Optional[str]
    batter_id: Optional[UUID]
    bowler_id: Optional[UUID]
    metadata: dict[str, Any]
    created_at: datetime


class InningsScorecard(BaseModel):
    innings: InningsOut
    total_runs: int
    total_wickets: int
    total_overs: float   # e.g. 5.3 = 5 overs 3 balls
    run_rate: float
    target: Optional[int]
    required_run_rate: Optional[float]
    balls: list[BallEventOut]
    # Team-linked additions (null / empty in quick mode)
    current_striker_id: Optional[UUID] = None
    current_non_striker_id: Optional[UUID] = None
    current_bowler_id: Optional[UUID] = None
    current_over_number: int = 0
    batters: list[BatterStats] = []
    bowlers: list[BowlerStats] = []


class MatchScorecard(BaseModel):
    match: MatchOut
    rules: dict[str, Any]
    innings_list: list[InningsScorecard]


class UpdateMatchRulesRequest(BaseModel):
    rules: MatchRules
