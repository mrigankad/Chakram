from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Optional

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.services import connector_registry
from app.services import connector_settings_service as connectors

router = APIRouter(prefix="/orgs", tags=["Organizations"])


@router.get("/current", response_model=OrganizationOut)
async def current_organization(org: OrganizationOut = Depends(get_current_org)):
    return org


class ConnectorsUpdateIn(BaseModel):
    github: Optional[dict[str, Any]] = None
    jira: Optional[dict[str, Any]] = None
    vercel: Optional[dict[str, Any]] = None
    ollama: Optional[dict[str, Any]] = None
    slack: Optional[dict[str, Any]] = None
    # Saved values to remove, e.g. {"github": ["token"]}. A blank secret means
    # "keep what is saved", so removing one has to be asked for explicitly.
    clear: Optional[dict[str, list[str]]] = None


@router.get("/current/connectors")
async def get_connectors(org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    raw = await connectors.get_raw(db, org.id)
    return connectors.public_view(raw, platform=connectors.is_platform_org(org))


@router.put("/current/connectors")
async def put_connectors(
    body: ConnectorsUpdateIn,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    try:
        await connectors.update(db, org.id, body.model_dump(exclude_none=True))
        raw = await connectors.get_raw(db, org.id)
        return connectors.public_view(raw, platform=connectors.is_platform_org(org))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/current/connectors/status")
async def connectors_status(org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    """What each connector enables, whether it is configured, and the last check result."""
    return {"connectors": await connector_registry.status(db, org)}


@router.post("/current/connectors/{connector_id}/check")
async def check_connector(connector_id: str, org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    """A read-only probe with the resolved credentials; a failing probe is a 200 with ok=false."""
    try:
        return await connector_registry.run_check(db, org, connector_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown connector '{connector_id}'")
