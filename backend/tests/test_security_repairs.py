"""GAP-02 (PAT in the body), GAP-03 (TLS verified on the pre-flight) and
GAP-22 (commit author from settings)."""
import logging

import git
import pytest

from app.auth.session import create_session_cookie
from app.config import settings
from app.models.workspace_models import CommitRequest
from app.routes import github as github_routes
from app.routes import repo_analysis as repo_routes
from app.services import git_service, organization_service, workspace_service


async def _login(app_client, db, name="org_s") -> str:
    org = await organization_service.create_organization(db, workos_org_id=name, name=name)
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))
    return org.id


# ── GAP-02: commit review takes the PAT from the body, never the query string ─

async def test_review_commit_reads_the_pat_from_the_body_only(app_client, db, monkeypatch):
    await _login(app_client, db)
    seen: list = []

    async def fake_diff(owner, repo, sha, pat):
        seen.append(pat)
        return []

    monkeypatch.setattr(github_routes.github_service, "get_commit_diff", fake_diff)

    resp = await app_client.post(
        "/api/github/commits/abc1234/review",
        params={"owner": "o", "repo": "r", "pat": "ghp_from_query"},
        json={"pat": "ghp_from_body", "custom_rules": None},
    )
    assert resp.status_code == 200
    assert seen == ["ghp_from_body"]

    resp = await app_client.post("/api/github/commits/abc1234/review", params={"owner": "o", "repo": "r"})
    assert resp.status_code == 200
    assert seen[-1] is None


# ── GAP-03: TLS is verified on the target-URL pre-flight unless opted out ────

class _Client:
    kwargs: list[dict] = []

    def __init__(self, **kwargs):
        _Client.kwargs.append(kwargs)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, timeout=None):
        import httpx
        return httpx.Response(200, request=httpx.Request("GET", url))


@pytest.fixture
def client_stub(monkeypatch):
    _Client.kwargs = []
    monkeypatch.setattr(repo_routes.httpx, "AsyncClient", _Client)
    return _Client


async def test_preflight_verifies_tls_by_default(client_stub, caplog):
    with caplog.at_level(logging.WARNING, logger="repo_analysis"):
        assert await repo_routes._check_url_reachable("https://staging.test") is None
    assert client_stub.kwargs[0]["verify"] is True
    assert "allow_insecure_tls" not in caplog.text


async def test_preflight_opt_out_disables_verification_and_warns(client_stub, caplog):
    with caplog.at_level(logging.WARNING, logger="repo_analysis"):
        assert await repo_routes._check_url_reachable("https://staging.test", allow_insecure_tls=True) is None
    assert client_stub.kwargs[0]["verify"] is False
    assert "allow_insecure_tls" in caplog.text


async def test_analyze_route_passes_the_tls_opt_out_through(app_client, db, monkeypatch):
    await _login(app_client, db, "org_tls")
    seen: list = []

    async def ok(*_a, **_k):
        return None

    async def preflight(url, allow_insecure_tls=False):
        seen.append(allow_insecure_tls)
        return None

    async def create_job(*_a, **_k):
        return "job-1"

    monkeypatch.setattr(repo_routes, "_require_fetchable_target", ok)
    monkeypatch.setattr(repo_routes, "_check_url_reachable", preflight)
    monkeypatch.setattr(repo_routes, "create_job", create_job)
    monkeypatch.setattr(repo_routes, "run_analysis", ok)

    body = {"github_url": "https://github.com/x/y", "target_url": "https://staging.test"}
    assert (await app_client.post("/api/repo/analyze", json=body)).status_code == 202
    assert (await app_client.post("/api/repo/analyze", json={**body, "allow_insecure_tls": True})).status_code == 202
    assert seen == [False, True]


# ── GAP-22: commit author comes from settings unless the request names one ───

@pytest.fixture
def workspace(tmp_path):
    clone = tmp_path / "clone"
    clone.mkdir()
    repo = git.Repo.init(clone)
    (clone / "README.md").write_text("hi\n", encoding="utf-8")
    repo.index.add(["README.md"])
    actor = git.Actor("t", "t@example.com")
    repo.index.commit("init", author=actor, committer=actor)
    repo.create_remote("origin", str(tmp_path / "no-such-remote.git"))
    branch = repo.active_branch.name
    repo.close()
    workspace_service._WORKSPACES["ws_author"] = {
        "workspace_id": "ws_author", "org_id": "org_a", "clone_dir": str(clone), "pat": "ghp_x",
    }
    yield clone, branch
    workspace_service._WORKSPACES.pop("ws_author", None)


async def test_commit_author_defaults_to_the_configured_author(workspace, monkeypatch):
    clone, branch = workspace
    monkeypatch.setattr(settings, "COMMIT_AUTHOR_NAME", "Chakram Bot")
    monkeypatch.setattr(settings, "COMMIT_AUTHOR_EMAIL", "bot@chakram.test")

    await git_service.commit_and_push("org_a", "ws_author", branch, ["a.txt"], "add a", {"a.txt": "a"})

    head = git.Repo(clone).head.commit
    assert (head.author.name, head.author.email) == ("Chakram Bot", "bot@chakram.test")


async def test_commit_author_override_is_kept(workspace):
    clone, branch = workspace

    await git_service.commit_and_push(
        "org_a", "ws_author", branch, ["b.txt"], "add b", {"b.txt": "b"},
        author_name="Dev One", author_email="dev@example.com",
    )

    head = git.Repo(clone).head.commit
    assert (head.author.name, head.author.email) == ("Dev One", "dev@example.com")


def test_commit_request_has_no_hard_coded_author():
    req = CommitRequest(workspace_id="w", branch="main", files=[], message="m")
    assert req.author_name is None and req.author_email is None
