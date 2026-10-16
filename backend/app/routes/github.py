"""GitHub proxy routes shields the GITHUB_TOKEN from the browser."""
import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import get_current_org
from app.config import settings
from app.database import get_db
from app.models.organization import OrganizationOut
from app.services import ci_metrics_service, github_service
from app.services.ai_service import review_pull_request

router = APIRouter(prefix="/github", tags=["GitHub"])


class ReviewCommitRequest(BaseModel):
    custom_rules: Optional[str] = None
    # Personal access token for private repos: in the body, never a query parameter
    # (those land in access logs and browser history).
    pat: Optional[str] = None


class ReviewPRRequest(BaseModel):
    custom_rules: Optional[str] = None


def _review_coverage(review: dict, files_in_change: int) -> dict:
    """Real coverage counts for a review response.

    `files_in_change` is the size of the PR/commit as GitHub reports it, which
    can exceed the number of files fetched (the files API is paginated).
    """
    meta = review.get("meta") or {}
    files_reviewed = int(meta.get("files_reviewed") or 0)
    files_failed = int(meta.get("files_failed") or 0)
    files_truncated = int(meta.get("files_truncated") or 0)
    files_in_change = max(files_in_change, int(meta.get("files_in_pr") or 0))
    files_skipped = max(0, files_in_change - files_reviewed - files_failed)
    status = meta.get("review_status") or "complete"
    if status == "complete" and (files_skipped or files_truncated):
        status = "partial"
    return {
        "files_in_pr": files_in_change,
        "files_reviewed": files_reviewed,
        "files_failed": files_failed,
        "files_skipped": files_skipped,
        "files_truncated": files_truncated,
        "review_status": status,
    }


def _require_repo(owner: str, repo: str) -> None:
    if not owner.strip() or not repo.strip():
        raise HTTPException(status_code=422, detail="owner and repo are required")


@router.get("/repo-info")
async def repo_info(owner: str, repo: str, org: OrganizationOut = Depends(get_current_org)):
    _require_repo(owner, repo)
    return await github_service.get_repo_info(owner, repo)


@router.get("/prs")
async def list_prs(owner: str, repo: str, per_page: int = 10, org: OrganizationOut = Depends(get_current_org)):
    _require_repo(owner, repo)
    return await github_service.get_open_prs(owner, repo, per_page)


@router.get("/pr/{pr_number}/files")
async def pr_files(owner: str, repo: str, pr_number: int, org: OrganizationOut = Depends(get_current_org)):
    return await github_service.get_pr_files(owner, repo, pr_number)


@router.post("/pr/{pr_number}/review")
async def ai_review_pr(
    owner: str,
    repo: str,
    pr_number: int,
    req: Optional[ReviewPRRequest] = None,
    org: OrganizationOut = Depends(get_current_org),
):
    """Fetch PR files and run AI code review."""
    detail, files = await asyncio.gather(
        github_service.get_pr_detail(owner, repo, pr_number),
        github_service.get_pr_files(owner, repo, pr_number),
    )
    custom_rules = req.custom_rules if req else None
    review = await review_pull_request(
        detail.get("title", ""),
        detail.get("body") or "",
        files,
        custom_rules=custom_rules,
    )
    return {
        "pr_number": pr_number,
        "pr_title": detail.get("title", ""),
        "author": detail.get("user", {}).get("login", ""),
        "review": review,
        **_review_coverage(review, int(detail.get("changed_files") or len(files))),
        "engine_version": review.get("meta", {}).get("engine_version", "v1"),
        "review_v2_enabled": settings.PR_REVIEW_V2_ENABLED,
    }


@router.get("/commits")
async def list_commits(
    owner: str,
    repo: str,
    since_days: int = 90,
    refresh: bool = False,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    commits, _ = await ci_metrics_service.get_commits(db, org.id, owner, repo, since_days, refresh=refresh)
    return commits


@router.post("/commits/{sha}/review")
async def review_commit(
    sha: str,
    owner: str,
    repo: str,
    req: Optional[ReviewCommitRequest] = None,
    org: OrganizationOut = Depends(get_current_org),
):
    """Fetch a commit's diff and run AI code review (no PR required)."""
    pat = (req.pat or None) if req else None
    files = await github_service.get_commit_diff(owner, repo, sha, pat)
    if not files:
        # Nothing was reviewed, so no recommendation or coverage figure is given.
        return {
            "sha": sha,
            "review": {
                "summary": "No file changes found for this commit.",
                "findings": [],
                "security_flags": [],
                "positives": [],
                "recommendation": "INCOMPLETE",
                "coverage_estimate": None,
            },
            "files_in_pr": 0,
            "files_reviewed": 0,
            "files_failed": 0,
            "files_skipped": 0,
            "files_truncated": 0,
            "review_status": "complete",
        }

    custom_rules = req.custom_rules if req else None

    review = await review_pull_request(
        pr_title=f"Commit {sha[:7]}",
        pr_body="",
        files=files,
        custom_rules=custom_rules,
    )
    return {"sha": sha, "review": review, **_review_coverage(review, len(files))}


@router.get("/workflow-runs")
async def workflow_runs(
    owner: str,
    repo: str,
    per_page: int = 30,
    refresh: bool = False,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    runs, _ = await ci_metrics_service.get_workflow_runs(db, org.id, owner, repo, refresh=refresh)
    return runs[:max(1, per_page)]
