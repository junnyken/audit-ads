from __future__ import annotations

import logging
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context
from app.core.config import get_settings
from app.db.base import Base
from app.models import entities  # noqa: F401  (imported for metadata registration)

config = context.config
if config.config_file_name is not None:
    # `disable_existing_loggers=False` is load-bearing, not tidiness. The default is True, which
    # silences every logger that already exists — including `app.migration`, the one that reports
    # whether a startup migration succeeded or blew up.
    #
    # Found on 2026-09-12 while releasing migrations 0011-0015 to production: the log showed
    # "applying migrations at startup" and alembic's own three lines, then nothing. Neither
    # "migration complete" nor "migration failed" could ever appear, because this call had already
    # disabled the logger that emits them. Rule 23 says to set MIGRATE_ON_START for one release,
    # **watch the log**, and unset it — and the log was structurally incapable of answering. A
    # failed migration would have been completely silent.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

config.set_main_option("sqlalchemy.url", get_settings().database_url)
target_metadata = Base.metadata
logger = logging.getLogger("alembic.runtime.migration")


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            logger.info("running migrations")
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
