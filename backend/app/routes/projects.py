"""Projects: the record both halves of Chakram share (ADR-6)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.services import project_service

router = APIRouter(prefix="/projects", tags=["Projects"])


class ImportRepoRequest(BaseModel):
    repo_url: str = Field(..., min_length=8)
    name: str = ""
    default_branch: str = "main"


@router.get("")
async def list_projects(org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    return {"projects": await project_service.list_projects(db, org.id)}


@router.post("/import", status_code=201)
async def import_repo(body: ImportRepoRequest, org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    url = body.repo_url.strip()
    if not url.startswith(("https://github.com/", "http://github.com/")):
        raise HTTPException(status_code=400, detail="Only GitHub repository URLs are supported for now.")
    project = await project_service.ensure_for_repo(db, org.id, url, name=body.name.strip(), default_branch=body.default_branch or "main")
    return await project_service.get(db, org.id, project["id"])


@router.get("/{project_id}")
async def get_project(project_id: str, org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    project = await project_service.get(db, org.id, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.post("/{project_id}/health")
async def check_project_health(project_id: str, org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    """Probe the deployed app's /api/health and /api/ready (stored on the project)."""
    result = await project_service.check_health(db, org.id, project_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return result


@router.get("/{project_id}/gate")
async def project_release_gate(project_id: str, org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    """Go / no-go from the project's own test run, deployment and health; nothing else is scored."""
    project = await project_service.get(db, org.id, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project_service.gate_from(project)
