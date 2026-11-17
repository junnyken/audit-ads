"""Operator-named schema upgrade at startup.

**This is a deliberate, documented narrowing of hard rule 23**, which says the API image must
never migrate on container start. That rule exists because a crash-looping container would
otherwise replay migrations with nobody watching, and because a schema change should be a step
someone chose, not a side effect of a restart.

The rule assumed a host with a shell. The deployment platform in use has none: no console, no
release command, and a database reachable only on the platform's internal network, so
`alembic upgrade head` cannot be run from anywhere else. The choice was between an unmigrated
database and a controlled path, and this is the controlled path.

**What keeps it controlled.** `MIGRATE_ON_START` is not a boolean. It carries the revision the
operator expects the code to be at, and the upgrade runs only if the code's head revision is
exactly that string. So it cannot silently apply a migration nobody named: ship a new revision
with a stale value still set and the container refuses to migrate and says so. It also cannot
be turned on by accident, because "true" is not a revision id.

**What is still true from rule 23.** Nothing migrates unless an operator set that value for
this release. `alembic upgrade head` is idempotent, so a restart with the flag left on is a
no-op rather than a repeated schema change. A failure here is loud and does not start the app
half-migrated.

Set it for the release, watch the log line, then unset it.
"""
from __future__ import annotations

import logging
import os

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

logger = logging.getLogger("app.migration")

ENV_VAR = "MIGRATE_ON_START"


def _alembic_config(backend_dir: str) -> Config:
    config = Config(os.path.join(backend_dir, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(backend_dir, "alembic"))
    return config


def head_revision(backend_dir: str) -> str | None:
    """The revision this code would upgrade to, or None if it cannot be determined."""
    try:
        return ScriptDirectory.from_config(_alembic_config(backend_dir)).get_current_head()
    except Exception:
        logger.exception("could not read the migration head")
        return None


def run_if_requested(backend_dir: str) -> None:
    """Upgrade to head, but only when the operator named this exact head revision.

    Never raises: a startup that dies here leaves no way to read the reason from a platform
    that only shows a restarting container. The failure is logged and the app starts; the
    endpoints that need the schema will fail loudly and honestly instead.
    """
    requested = (os.environ.get(ENV_VAR) or "").strip()
    if not requested:
        return

    head = head_revision(backend_dir)
    if head is None:
        logger.error("migration requested but the head revision is unreadable; not migrating")
        return

    if requested != head:
        # Names the two revisions, which are public identifiers, and no configuration value.
        logger.error(
            "migration refused: the requested revision is not this code's head",
            extra={"requested": requested, "head": head},
        )
        return

    logger.warning("applying migrations at startup because %s names this head", ENV_VAR)
    try:
        command.upgrade(_alembic_config(backend_dir), "head")
    except Exception:
        logger.exception("migration failed; the schema may be incomplete")
        return
    logger.warning("migration complete", extra={"head": head})
