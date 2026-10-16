"""
Git service commit, push, branch, status, log via GitPython.
Operates on workspaces managed by workspace_service.
"""
import asyncio
import logging
import re
import tempfile
from time import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import git
from git import Actor

from app.config import settings
from app.services import connector_settings_service as connectors
from app.services.workspace_service import WORKSPACE_TEMP_DIR, _redact_credentials, get_workspace

log = logging.getLogger(__name__)

# Cache git status with 5-second TTL to avoid redundant operations
_GIT_STATUS_CACHE = {}  # (org_id, workspace_id) → (data, timestamp)
_GIT_CACHE_TTL = 5


class WorkspaceNotFound(KeyError):
    """Raised when a workspace is missing or not owned by the org."""


MISSING_TOKEN_MESSAGE = (
    "GitHub needs a token to accept this push and none is available. "
    "Add a GitHub token under Settings → Connectors, then retry the push."
)


class PushError(Exception):
    """A push that did not reach the remote. Both texts are safe to return to the client.

    `reason` is the short cause (what the commit endpoint reports as `push_error`);
    `message` is the full sentence the push endpoint returns.
    """

    def __init__(self, reason: str, message: Optional[str] = None, status_code: int = 502):
        super().__init__(message or reason)
        self.reason = reason
        self.message = message or reason
        self.status_code = status_code


class PushTokenMissing(PushError):
    """The remote asked for credentials and no GitHub token is available."""

    def __init__(self):
        super().__init__(MISSING_TOKEN_MESSAGE, status_code=400)


# stderr fragments (lower case) that mean the remote refused the credentials.
_AUTH_FAILURE_MARKERS = (
    "could not read username",
    "could not read password",
    "terminal prompts disabled",
    "authentication failed",
    "invalid username or password",
    "permission denied",
    "permission to ",
    "returned error: 401",
    "returned error: 403",
    "repository not found",
)

_BRANCH_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,254}")


def _require_workspace(org_id: str, workspace_id: str) -> dict:
    ws = get_workspace(org_id, workspace_id)
    if ws is None:
        raise WorkspaceNotFound(workspace_id)
    return ws


def _get_repo(org_id: str, workspace_id: str) -> tuple[git.Repo, Path]:
    ws = _require_workspace(org_id, workspace_id)
    clone_dir = ws["clone_dir"]
    repo = git.Repo(clone_dir)
    return repo, Path(clone_dir)


def _strip_persisted_credentials(repo: git.Repo) -> None:
    """Remove any credentials an earlier run baked into origin's URL."""
    try:
        url = repo.remotes.origin.url
    except Exception:
        return
    clean = _redact_credentials(url)
    if clean == url:
        return
    # Drop the "user:token@" segment entirely rather than leaving "***@".
    scheme, _, rest = url.partition("://")
    with repo.remotes.origin.config_writer as cw:
        cw.set("url", f"{scheme}://{rest.split('@', 1)[-1]}")


def _origin_url_with_pat(remote_url: str, pat: Optional[str]) -> str:
    if not pat:
        return remote_url
    if remote_url.startswith("https://github.com/"):
        return remote_url.replace("https://github.com/", f"https://{pat}@github.com/")
    return remote_url


def _safe_workspace_path(base: Path, rel_path: str) -> Path:
    """Resolve rel_path under base; reject anything outside it or inside .git."""
    root = base.resolve()
    target = (base / rel_path).resolve()
    try:
        inside = target.relative_to(root)
    except ValueError:
        raise ValueError(f"Invalid file path (outside the workspace): {rel_path}") from None
    if not inside.parts:
        raise ValueError(f"Invalid file path: {rel_path!r}")
    if inside.parts[0].lower() == ".git":
        raise ValueError(f"Invalid file path (inside .git): {rel_path}")
    return target


def _scrub_push_error(text: str, pat: Optional[str], clone_dir: str = "") -> str:
    """Make push failure text safe to return: no token, no server paths."""
    text = _redact_credentials(text)
    if pat:
        text = text.replace(pat, "***")
    if clone_dir:
        text = text.replace(clone_dir, "<workspace>")
    return text.strip()[:300]


def safe_error_text(exc: Exception) -> str:
    """An exception as text that is safe to return to the browser.

    Git failures are reduced to the last line of stderr (GitPython's str() embeds
    the whole command line); everything has credentials and temp-dir paths removed.
    """
    stderr = str(getattr(exc, "stderr", "") or "").strip()
    if stderr:
        stderr = stderr.removeprefix("stderr:").strip().strip("'\"")
        lines = [ln.strip() for ln in stderr.splitlines() if ln.strip()]
        text = lines[-1] if lines else ""
    else:
        text = str(exc)
    text = _scrub_push_error(text, None)
    for root in {WORKSPACE_TEMP_DIR, tempfile.gettempdir()}:
        for form in {root, root.replace("\\", "/")}:
            if form:
                text = text.replace(form, "<workspace>")
    return text or "The git operation failed."


def _push_error_reason(exc: Exception, pat: Optional[str], clone_dir: str) -> str:
    # GitPython's str(exc) embeds the whole command line; stderr has the reason.
    stderr = str(getattr(exc, "stderr", "") or "").strip()
    stderr = stderr.removeprefix("stderr:").strip().strip("'\"")
    lines = [ln.strip() for ln in stderr.splitlines() if ln.strip()]
    reason = lines[-1] if lines else type(exc).__name__
    return _scrub_push_error(reason, pat, clone_dir) or "push failed"


def _resolve_push_token(ws: dict) -> Optional[str]:
    """Token for a push: the one the workspace was opened with, else the org's GitHub connector.

    The connector follows the usual rules (org setting, then the server token for
    platform orgs only). Call this on the request's own task, not in a worker thread.
    """
    return ws.get("pat") or connectors.active("github").get("token") or None


def _validate_branch(branch: str) -> str:
    """Reject anything that is not a plain branch name (options, refspecs, paths out of refs/heads)."""
    name = branch.strip() if isinstance(branch, str) else ""
    if (
        not _BRANCH_RE.fullmatch(name)
        or ".." in name
        or "//" in name
        or name.endswith(("/", ".", ".lock"))
    ):
        raise ValueError(f"Invalid branch name: {branch!r}")
    return name


def _commit_url(origin_url: str, sha: str) -> str:
    remote_url = origin_url.rstrip("/")
    if remote_url.endswith(".git"):
        remote_url = remote_url[:-4]
    if "@github.com" in remote_url:
        remote_url = "https://github.com/" + remote_url.split("@github.com/")[-1]
    return f"{remote_url}/commit/{sha}"


def _run_git_push(repo: git.Repo, target: str, refspec: str) -> str:
    """Run the push and return git's --porcelain output. Raises GitCommandError on failure."""
    # Fail instead of waiting on a credential prompt nobody can answer.
    with repo.git.custom_environment(GIT_TERMINAL_PROMPT="0"):
        return repo.git.push("--porcelain", target, refspec)


def _push_branch(repo: git.Repo, clone_dir: str, branch: str, token: Optional[str]) -> bool:
    """Push `branch` to origin.

    Returns True when commits were sent and False when the remote already had
    them. Raises PushError, whose text never contains the token or server paths.
    """
    try:
        origin_url = repo.remotes.origin.url
    except (AttributeError, IndexError):
        raise PushError("This workspace has no 'origin' remote to push to.", status_code=400) from None

    # Never persist the token. Writing the tokenised URL into .git/config leaves
    # the credential on disk for the life of the workspace; passing it as a
    # one-off push argument does not.
    _strip_persisted_credentials(repo)
    origin_url = repo.remotes.origin.url
    push_url = _origin_url_with_pat(origin_url, token)
    target = push_url if push_url != origin_url else "origin"
    try:
        output = _run_git_push(repo, target, f"refs/heads/{branch}:refs/heads/{branch}")
    except Exception as exc:
        # The failure text can contain the tokenised URL — scrub before use.
        reason = _push_error_reason(exc, token, clone_dir)
        log.warning("Push of %s failed: %s", branch, reason)
        stderr = str(getattr(exc, "stderr", "") or "").lower()
        if any(marker in stderr for marker in _AUTH_FAILURE_MARKERS):
            if not token:
                raise PushTokenMissing() from None
            message = (
                f"GitHub rejected the token used for this push ({reason}). Check that the GitHub token "
                "under Settings → Connectors is valid and can write to this repository, then retry the push."
            )
            raise PushError(message) from None
        raise PushError(reason, f"Push failed: {reason}") from None

    # Porcelain ref lines are "<flag>\t<from>:<to>\t<summary>"; "=" means up to date.
    flags = [line[0] for line in output.splitlines() if "\t" in line and line[0] != "\t"]
    return not (flags and all(flag == "=" for flag in flags))


async def get_status(org_id: str, workspace_id: str) -> dict:
    cache_key = (org_id, workspace_id)
    cached = _GIT_STATUS_CACHE.get(cache_key)
    if cached:
        data, ts = cached
        if time() - ts < _GIT_CACHE_TTL:
            return data

    def _do():
        repo, _ = _get_repo(org_id, workspace_id)
        staged = [item.a_path for item in repo.index.diff("HEAD")]
        unstaged = [item.a_path for item in repo.index.diff(None)]
        untracked = repo.untracked_files
        try:
            branch = repo.active_branch.name
        except TypeError:
            branch = "HEAD"
        return {
            "workspace_id": workspace_id,
            "branch": branch,
            "staged": staged,
            "unstaged": unstaged,
            "untracked": list(untracked),
        }

    result = await asyncio.to_thread(_do)
    _GIT_STATUS_CACHE[cache_key] = (result, time())
    return result


async def get_log(org_id: str, workspace_id: str, max_count: int = 20) -> list[dict]:
    def _do():
        repo, _ = _get_repo(org_id, workspace_id)
        entries = []
        for commit in repo.iter_commits(max_count=max_count):
            entries.append({
                "sha": commit.hexsha,
                "short_sha": commit.hexsha[:7],
                "message": commit.message.strip().splitlines()[0],
                "author": str(commit.author),
                "date": commit.committed_datetime.isoformat(),
            })
        return entries
    return await asyncio.to_thread(_do)


async def get_file_diff(org_id: str, workspace_id: str, file_path: str) -> str:
    def _do():
        repo, _ = _get_repo(org_id, workspace_id)
        try:
            return repo.git.diff("HEAD", "--", file_path)
        except Exception:
            return ""
    return await asyncio.to_thread(_do)


async def create_branch(
    org_id: str,
    workspace_id: str,
    branch_name: str,
    from_branch: str | None = None,
) -> dict:
    def _do():
        repo, _ = _get_repo(org_id, workspace_id)
        new_name = _validate_branch(branch_name)
        if not from_branch:
            # Repos default to main, master or anything else: use what is checked out.
            base = repo.active_branch.name
        else:
            base = _validate_branch(from_branch)
        try:
            repo.git.checkout(base)
        except git.GitCommandError as exc:
            raise ValueError(
                f"Could not check out base branch {base!r}: {safe_error_text(exc)}"
            ) from exc
        if new_name in [h.name for h in repo.heads]:
            raise ValueError(f"Branch {new_name!r} already exists in this workspace.")
        new_branch = repo.create_head(new_name)
        new_branch.checkout()
        return {"branch": new_name, "from": base}
    return await asyncio.to_thread(_do)


async def commit_and_push(
    org_id: str,
    workspace_id: str,
    branch: str,
    files: list[str],
    message: str,
    new_file_contents: dict[str, str],
    author_name: str | None = None,
    author_email: str | None = None,
) -> dict:
    """
    Write new file contents, stage given files, commit, and push.
    Returns commit SHA + GitHub URL.

    The commit author defaults to settings.COMMIT_AUTHOR_NAME / COMMIT_AUTHOR_EMAIL;
    a request may name another author.
    """
    author_name = author_name or settings.COMMIT_AUTHOR_NAME
    author_email = author_email or settings.COMMIT_AUTHOR_EMAIL
    pat = _resolve_push_token(_require_workspace(org_id, workspace_id))

    def _do():
        ws = _require_workspace(org_id, workspace_id)
        repo = git.Repo(ws["clone_dir"])
        base = Path(ws["clone_dir"])

        # Validate every path before writing any of them.
        targets = [
            (_safe_workspace_path(base, rel_path), content)
            for rel_path, content in new_file_contents.items()
        ]
        for abs_path, content in targets:
            abs_path.parent.mkdir(parents=True, exist_ok=True)
            abs_path.write_text(content, encoding="utf-8")

        try:
            repo.git.checkout(branch)
        except git.GitCommandError:
            repo.git.checkout("-b", branch)

        repo.index.add(files)

        actor = Actor(author_name, author_email)
        commit = repo.index.commit(message, author=actor, committer=actor)

        push_ok, push_error = True, None
        try:
            _push_branch(repo, ws["clone_dir"], branch, pat)
        except PushError as exc:
            push_ok, push_error = False, exc.reason

        github_url = _commit_url(repo.remotes.origin.url, commit.hexsha)

        return {
            "sha": commit.hexsha,
            "message": message,
            "branch": branch,
            "github_url": github_url,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "push_ok": push_ok,
            "push_error": push_error,
        }

    return await asyncio.to_thread(_do)


async def push_branch(org_id: str, workspace_id: str, branch: Optional[str] = None) -> dict:
    """Push the workspace's existing commits on `branch` (default: the checked-out branch).

    Creates no commit and writes no file. Raises WorkspaceNotFound, ValueError
    (bad or unknown branch) or PushError.
    """
    ws = _require_workspace(org_id, workspace_id)
    token = _resolve_push_token(ws)
    requested = _validate_branch(branch) if branch is not None else None
    clone_dir = ws["clone_dir"]

    def _do():
        try:
            repo = git.Repo(clone_dir)
        except Exception:
            raise PushError("The workspace is not a git repository.", status_code=400) from None
        try:
            name = requested
            if name is None:
                try:
                    name = repo.active_branch.name
                except TypeError:
                    raise ValueError("The workspace is not on a branch. Name the branch to push.") from None
            head = next((h for h in repo.heads if h.name == name), None)
            if head is None:
                raise ValueError(f"Branch {name!r} does not exist in this workspace.")
            sha = head.commit.hexsha
            pushed = _push_branch(repo, clone_dir, name, token)
            github_url = _commit_url(repo.remotes.origin.url, sha)
        finally:
            repo.close()
        return {
            "workspace_id": workspace_id,
            "branch": name,
            "sha": sha,
            "github_url": github_url,
            "pushed": pushed,
            "up_to_date": not pushed,
            "message": (
                f"Pushed {sha[:7]} to {name}." if pushed
                else f"Nothing to push: {name} is already up to date on the remote ({sha[:7]})."
            ),
        }

    return await asyncio.to_thread(_do)
