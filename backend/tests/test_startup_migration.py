"""The operator-named startup migration.

Rule 23 says the image must never migrate on start. This narrows that rather than dropping it,
so the tests are about the guard, not the upgrade: what makes it refuse, and what makes it
silent. The upgrade itself is exercised by every test session, which runs the real migration
against a clean database (see conftest).
"""
from __future__ import annotations

import pathlib

import pytest

from app import startup_migration
from app.startup_migration import ENV_VAR, head_revision, run_if_requested

BACKEND_DIR = str(pathlib.Path(__file__).resolve().parents[1])


@pytest.fixture()
def spy(monkeypatch):
    """Record whether an upgrade would have been attempted, without touching a database."""
    calls: list[str] = []
    monkeypatch.setattr(
        startup_migration.command, "upgrade", lambda config, target: calls.append(target)
    )
    return calls


def test_the_head_revision_is_readable():
    """Everything else depends on this, and it is the one part that reads the real tree."""
    assert head_revision(BACKEND_DIR)


def test_nothing_happens_when_the_variable_is_unset(spy, monkeypatch):
    monkeypatch.delenv(ENV_VAR, raising=False)
    run_if_requested(BACKEND_DIR)
    assert spy == []


@pytest.mark.parametrize("value", ["", "   ", "true", "1", "yes", "on", "head"])
def test_a_boolean_shaped_value_does_not_migrate(spy, monkeypatch, value):
    """The variable names a revision. "true" is not one, so it cannot be switched on by habit."""
    monkeypatch.setenv(ENV_VAR, value)
    run_if_requested(BACKEND_DIR)
    assert spy == []


def test_a_stale_revision_is_refused(spy, monkeypatch):
    """The case this guard exists for: a new migration shipped, the old value left behind."""
    monkeypatch.setenv(ENV_VAR, "0004_a4_operational_runs")
    run_if_requested(BACKEND_DIR)
    assert spy == [], "a value naming an older revision must never apply the newer one"


def test_naming_this_head_applies_the_upgrade(spy, monkeypatch):
    monkeypatch.setenv(ENV_VAR, head_revision(BACKEND_DIR))
    run_if_requested(BACKEND_DIR)
    assert spy == ["head"]


def test_a_failing_upgrade_does_not_stop_the_process(monkeypatch):
    """A container that dies here only shows as 'restarting'; the reason must be readable."""

    def boom(config, target):
        raise RuntimeError("no")

    monkeypatch.setattr(startup_migration.command, "upgrade", boom)
    monkeypatch.setenv(ENV_VAR, head_revision(BACKEND_DIR))
    run_if_requested(BACKEND_DIR)  # must not raise


def test_an_unreadable_head_refuses_rather_than_guessing(spy, monkeypatch):
    monkeypatch.setattr(startup_migration, "head_revision", lambda _: None)
    monkeypatch.setenv(ENV_VAR, "anything")
    run_if_requested(BACKEND_DIR)
    assert spy == []
