"""Jira routes: two jobs, import stories as requirements and write results back.

Reads: projects, stories of the active sprint, open bugs (an optional Release
Gate signal). Writes: acceptance criteria and test results as issue comments.
Jira not configured is a 503 and an LLM failure a 429/502, both from the
app-level handlers (app.errors); nothing here re-wraps them. Sprint analytics
were retired (ADR-7).
"""
import asyncio
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.services import jira_service, project_service, requirement_service
from app.services.ai_service import generate_acceptance_criteria

router = APIRouter(prefix="/jira", tags=["Jira"])


@router.get("/projects")
async def list_projects(org: OrganizationOut = Depends(get_current_org)):
    return await jira_service.list_projects()


@router.get("/stories")
async def get_stories(
    project: str,
    sprint_id: str | None = None,
    max_results: int = 20,
    org: OrganizationOut = Depends(get_current_org),
):
    return await jira_service.get_sprint_stories(project, sprint_id, max_results)


@router.post("/stories/{issue_key}/generate-ac")
async def generate_ac_for_story(
    issue_key: str,
    body: dict = Body(default={}),
    org: OrganizationOut = Depends(get_current_org),
):
    """Fetch a Jira story and generate AI acceptance criteria for it."""
    project = body.get("project", issue_key.split("-")[0])
    stories = await jira_service.get_sprint_stories(project, max_results=30)
    story = next((s for s in stories if s["key"] == issue_key), None)
    if not story:
        raise HTTPException(status_code=404, detail=f"Story {issue_key} not found in active sprint")
    existing = [s for s in stories if s["key"] != issue_key]
    result = await generate_acceptance_criteria(story, existing)
    return {"issue_key": issue_key, "story": story, "ai_analysis": result}


@router.post("/stories/{issue_key}/update-ac")
async def push_ac_to_jira(
    issue_key: str,
    body: dict = Body(...),
    org: OrganizationOut = Depends(get_current_org),
):
    """Post AI-generated acceptance criteria to the Jira issue as a comment."""
    ac_text: str = (body.get("acceptance_criteria_text") or "").strip()
    if not ac_text:
        raise HTTPException(status_code=400, detail="acceptance_criteria_text is required")
    comment = await jira_service.add_issue_comment(issue_key, ac_text)
    return {"status": "commented", "issue_key": issue_key, "comment_id": comment["id"]}


@router.get("/bugs")
async def list_bugs(
    project: str,
    version: str | None = None,
    org: OrganizationOut = Depends(get_current_org),
):
    return await jira_service.get_open_bugs(project, version)


@router.post("/analyze-manual")
async def analyze_manual_story(body: dict = Body(...), org: OrganizationOut = Depends(get_current_org)):
    """
    Analyze a manually typed user story no Jira connection needed.
    Accepts: summary (required), description (optional), priority (optional).
    """
    summary = (body.get("summary") or "").strip()
    if not summary:
        raise HTTPException(status_code=400, detail="summary is required")
    story = {
        "key": "MANUAL-1",
        "summary": summary,
        "description": body.get("description") or "",
        "priority": body.get("priority") or "Medium",
        "status": "Open",
        "assignee": "Unassigned",
    }
    result = await generate_acceptance_criteria(story, [])
    return {"issue_key": "MANUAL-1", "story": story, "ai_analysis": result}


# ── Import stories as requirements ─────────────────────────────────────────

class ImportStoriesIn(BaseModel):
    project: str = Field(..., min_length=1)
    keys: list[str] = Field(..., min_length=1, max_length=20)


def requirement_text(story: dict) -> str:
    """The requirement a story becomes: key and summary on the first line, the description after."""
    head = f"{story['key']}: {story.get('summary', '').strip()}"
    desc = (story.get("description") or "").strip()
    return f"{head}\n\n{desc}" if desc else head


@router.post("/stories/import")
async def import_stories(
    body: ImportStoriesIn,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Create one requirement (with its generated test suite) per selected story.

    A story already imported by this org is returned as `exists` with its requirement id.
    Generation runs per story; a failure names the story and leaves the others intact.
    """
    wanted = list(dict.fromkeys(k.strip().upper() for k in body.keys if k.strip()))
    stories = {s["key"]: s for s in await jira_service.get_sprint_stories(body.project, max_results=50)}
    results: list[dict] = []

    async def _one(key: str) -> dict:
        story = stories.get(key)
        if story is None:
            return {"key": key, "status": "not_found", "error": f"{key} is not in the active sprint of {body.project}"}
        existing = await db.requirements.find_one({"org_id": org.id, "jira_key": key}, {"_id": 1})
        if existing is not None:
            return {"key": key, "status": "exists", "requirement_id": str(existing["_id"])}
        try:
            created = await requirement_service.create_requirement(db, org.id, requirement_text(story))
        except Exception as exc:  # noqa: BLE001 - reported per story, the others continue
            return {"key": key, "status": "failed", "error": str(exc) or type(exc).__name__}
        await db.requirements.update_one(
            {"_id": ObjectId(created["id"])},
            {"$set": {"source": "jira", "jira_key": key, "jira_project": body.project, "jira_summary": story.get("summary", "")}},
        )
        return {"key": key, "status": "created", "requirement_id": created["id"], "total_tests": created.get("total_tests", 0)}

    for outcome in await asyncio.gather(*(_one(k) for k in wanted)):
        results.append(outcome)
    return {
        "results": results,
        "created": sum(1 for r in results if r["status"] == "created"),
        "failed": sum(1 for r in results if r["status"] in ("failed", "not_found")),
    }


# ── Write results back ──────────────────────────────────────────────────────

class PostResultsIn(BaseModel):
    requirement_id: str = Field(..., min_length=1)


def results_comment(requirement: dict, run: dict) -> str:
    """The comment Chakram leaves on the story after a browser run."""
    executed = run["passed"] + run["failed"]
    rate = f"{round(run['pass_rate'] * 100)}%" if run.get("pass_rate") is not None else "no checkable case"
    when = run.get("completed_at") or run.get("created_at")
    when_text = when.strftime("%Y-%m-%d %H:%M UTC") if isinstance(when, datetime) else str(when or "")
    lines = [
        f"Chakram test results ({when_text})",
        f"{run['passed']} passed, {run['failed']} failed, {run['skipped']} skipped. Pass rate {rate} of {executed} executed.",
    ]
    if run.get("target_url"):
        lines.append(f"Target: {run['target_url']}")
    lines.append(f"Run {run['run_id']} for requirement {requirement.get('jira_key') or str(requirement['_id'])}.")
    if run["failed"]:
        lines.append("Failed cases are listed in Chakram's Test Execution page for this run.")
    return "\n".join(lines)


@router.post("/stories/{issue_key}/post-results")
async def post_results_to_jira(
    issue_key: str,
    body: PostResultsIn,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Comment the requirement's latest test run on the story. 409 when nothing has run."""
    try:
        requirement = await db.requirements.find_one({"_id": ObjectId(body.requirement_id), "org_id": org.id})
    except Exception:  # noqa: BLE001 - not an ObjectId
        requirement = None
    if requirement is None:
        raise HTTPException(status_code=404, detail="Requirement not found")
    run = await project_service.latest_run(db, org.id, body.requirement_id)
    if run is None or run["passed"] + run["failed"] + run["skipped"] == 0:
        raise HTTPException(status_code=409, detail="No test run for this requirement yet. Run it on Test Execution first.")
    text = results_comment(requirement, run)
    comment = await jira_service.add_issue_comment(issue_key, text)
    await db.requirements.update_one(
        {"_id": requirement["_id"]},
        {"$set": {"jira_results": {"issue_key": issue_key, "run_id": run["run_id"], "comment_id": comment["id"], "posted_at": datetime.now(timezone.utc)}}},
    )
    return {"status": "commented", "issue_key": issue_key, "comment_id": comment["id"], "run": {k: v for k, v in run.items() if k not in ("created_at", "completed_at")}, "comment": text}
