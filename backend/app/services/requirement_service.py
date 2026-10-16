"""
Requirements service: persists requirements and triggers test-case generation.
"""
import asyncio
import logging
from datetime import datetime
from bson import ObjectId

from app.models.requirement import RequirementOut
from app.services import ai_service
from app.services.test_case_service import create_test_cases_from_ai

log = logging.getLogger(__name__)


async def _mark_failed(db, req_id: str, error: str) -> None:
    """Record a failed generation. Never raises: the original error must surface."""
    try:
        await db.requirements.update_one(
            {"_id": ObjectId(req_id)},
            {"$set": {"status": "failed", "error": error[:300]}},
        )
    except Exception:
        log.exception("Could not mark requirement %s as failed", req_id)


async def create_requirement(db, org_id: str, text: str, instructions: str = None) -> dict:
    req_doc = {
        "org_id": org_id,
        "text": text,
        "created_at": datetime.utcnow(),
        "status": "pending",
    }
    result = await db.requirements.insert_one(req_doc)
    req_id = str(result.inserted_id)

    try:
        ai_data = await ai_service.generate_test_cases(text, instructions)
        await create_test_cases_from_ai(db, org_id, req_id, ai_data)
    except asyncio.CancelledError:
        await _mark_failed(db, req_id, "Generation was cancelled before it finished")
        raise
    except Exception as exc:
        await _mark_failed(db, req_id, str(exc) or type(exc).__name__)
        raise

    await db.requirements.update_one(
        {"_id": ObjectId(req_id)},
        {"$set": {"status": "processed"}},
    )

    return {
        "id": req_id,
        "text": text,
        "status": "processed",
        "test_case_categories": {k: len(v) for k, v in ai_data.items()},
        "total_tests": sum(len(v) for v in ai_data.values()),
    }


async def list_requirements(
    db,
    org_id: str,
    skip: int = 0,
    limit: int = 20,
    status: str | None = "processed",
) -> list[RequirementOut]:
    """Requirements for an org, newest first. `status=None` returns every status."""
    query: dict = {"org_id": org_id}
    if status:
        query["status"] = status
    cursor = db.requirements.find(query).skip(skip).limit(limit).sort("created_at", -1)
    docs = await cursor.to_list(length=limit)
    return [
        RequirementOut(
            id=str(d["_id"]),
            text=d["text"],
            created_at=d["created_at"],
            status=d["status"],
            error=d.get("error"),
            source=d.get("source"),
            jira_key=d.get("jira_key"),
            jira_results_posted_at=(d.get("jira_results") or {}).get("posted_at"),
        )
        for d in docs
    ]
