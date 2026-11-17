#!/usr/bin/env python3
"""Create the first workspace and owner on a local development database.

The API bootstraps an owner on startup, but only from `BOOTSTRAP_OWNER_EMAIL` and
`BOOTSTRAP_OWNER_PASSWORD`. With those unset there is no account to log in with — not on the
dashboard, and not from the Chrome extension — even though the whole stack is running fine.

This calls the product's own `bootstrap_owner()` rather than inserting rows: the password gets
the same PBKDF2 hashing, and the workspace membership is created the same way. It is idempotent
for the same reason that function is — once a workspace exists it does nothing.

    .venv/bin/python scripts/create_dev_owner.py you@example.com

The password is asked for at a hidden prompt, so it never reaches your shell history. It is
never printed, and it is not written to any file in this repo.

Development only. A real deployment sets the two environment variables and lets the API do this
on first start.
"""
from __future__ import annotations

import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.bootstrap import bootstrap_owner  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: .venv/bin/python scripts/create_dev_owner.py <email>")
        return 2
    email = sys.argv[1].strip().lower()

    password = getpass.getpass(f"Password for {email} (input is hidden): ").strip()
    if len(password) < 12:
        print("Refused: use at least 12 characters. Nothing was created.")
        return 2
    if password != getpass.getpass("Repeat it: ").strip():
        print("The two entries differ. Nothing was created.")
        return 2

    settings = get_settings()
    settings.bootstrap_owner_email = email
    settings.bootstrap_owner_password = password

    with SessionLocal() as session:
        workspace = bootstrap_owner(session)

    if workspace is None:
        print("Nothing was created — a workspace already exists, or the settings were refused.")
        return 1

    print(f"Created workspace '{workspace.name}' with owner {email}.")
    print("Sign in at the dashboard, or use the same email and password in the extension.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
