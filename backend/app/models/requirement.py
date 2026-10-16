from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field
from bson import ObjectId


class PyObjectId(str):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v, _info=None):
        if isinstance(v, ObjectId):
            return str(v)
        if ObjectId.is_valid(str(v)):
            return str(v)
        raise ValueError(f"Invalid ObjectId: {v}")

    @classmethod
    def __get_pydantic_core_schema__(cls, source_type, handler):
        from pydantic_core import core_schema
        return core_schema.no_info_plain_validator_function(cls.validate)


# ─── Requirement ────────────────────────────────────────────────────────────

class RequirementCreate(BaseModel):
    text: str = Field(..., min_length=10, description="Raw requirement text")
    instructions: Optional[str] = Field(default=None, description="Optional custom test case generation instructions")

class RequirementDB(BaseModel):
    id: Optional[PyObjectId] = Field(default=None, alias="_id")
    text: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    status: str = "pending"   # pending | processed | failed

    model_config = {"populate_by_name": True, "arbitrary_types_allowed": True}

class RequirementOut(BaseModel):
    id: str
    text: str
    created_at: datetime
    status: str
    error: Optional[str] = None
    source: Optional[str] = None  # "jira" | "app_studio" | None (typed by hand)
    jira_key: Optional[str] = None
    jira_results_posted_at: Optional[datetime] = None
