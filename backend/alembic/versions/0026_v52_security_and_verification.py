"""v5.2 WebApp Security Hardening, Email Verification, Lockout & Allowlist Trigger.

Revision ID: 0026_v52_security_and_verification
Revises: 0025_commercial_saas_license
Create Date: 2026-11-23 16:25:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0026_v52_security_and_verification"
down_revision = "0025_commercial_saas_license"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect_name = getattr(getattr(bind, "dialect", None), "name", "")
    if dialect_name == "postgresql":
        stmts = (
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ NULL",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS login_locked_until TIMESTAMPTZ NULL",
            """
            CREATE TABLE IF NOT EXISTS email_verification_tokens (
                id UUID PRIMARY KEY,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                email VARCHAR(320) NOT NULL,
                token_hash VARCHAR(64) NOT NULL UNIQUE,
                expires_at TIMESTAMPTZ NOT NULL,
                used_at TIMESTAMPTZ NULL,
                requested_ip_hash VARCHAR(64) NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """.strip(),
            "CREATE INDEX IF NOT EXISTS ix_email_verification_tokens_user_id ON email_verification_tokens (user_id)",
            """
            CREATE TABLE IF NOT EXISTS signup_email_allowlist (
                email VARCHAR(320) PRIMARY KEY,
                note VARCHAR(240) NOT NULL DEFAULT '',
                created_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """.strip(),
            """
            CREATE OR REPLACE FUNCTION public.adsops_guard_user_signup_email()
            RETURNS trigger
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = ''
            AS $$
            DECLARE
                v_email TEXT := lower(btrim(coalesce(NEW.email, '')));
                v_local TEXT;
                v_domain TEXT;
                v_norm TEXT;
            BEGIN
                IF v_email = '' OR position('@' IN v_email) = 0 THEN
                    RETURN NEW;
                END IF;
                IF coalesce(NEW.is_platform_admin, FALSE) THEN
                    NEW.email := v_email;
                    RETURN NEW;
                END IF;
                IF EXISTS (SELECT 1 FROM public.signup_email_allowlist a WHERE lower(a.email) = v_email) THEN
                    NEW.email := v_email;
                    RETURN NEW;
                END IF;
                v_local := split_part(v_email, '@', 1);
                v_domain := rtrim(split_part(v_email, '@', 2), '.');
                IF position('+' IN v_local) > 0 THEN
                    RAISE EXCEPTION 'APP_PLUS_EMAIL' USING ERRCODE = 'P0001';
                END IF;
                IF v_domain ~ '(tempmail|temp-mail|10minutemail|guerrillamail|mailinator|yopmail|trashmail|throwaway|fakeinbox|fakemail|burnermail|sharklasers|getnada|mohmal|maildrop|dispostable|mailnesia|^qq\\.com$|^163\\.com$|^mail\\.ru$)' THEN
                    RAISE EXCEPTION 'APP_DISPOSABLE_EMAIL' USING ERRCODE = 'P0001';
                END IF;
                IF v_domain IN ('gmail.com', 'googlemail.com') THEN
                    v_norm := replace(v_local, '.', '');
                    IF EXISTS (
                        SELECT 1 FROM public.users u
                        WHERE u.id IS DISTINCT FROM NEW.id
                          AND rtrim(split_part(lower(u.email), '@', 2), '.') IN ('gmail.com', 'googlemail.com')
                          AND replace(split_part(split_part(lower(u.email), '@', 1), '+', 1), '.', '') = v_norm
                    ) THEN
                        RAISE EXCEPTION 'APP_DUPLICATE_GMAIL' USING ERRCODE = 'P0001';
                    END IF;
                    NEW.email := v_norm || '@gmail.com';
                ELSE
                    NEW.email := v_local || '@' || v_domain;
                END IF;
                RETURN NEW;
            END;
            $$
            """.strip(),
            "DROP TRIGGER IF EXISTS on_users_block_disposable_email ON public.users",
            """
            CREATE TRIGGER on_users_block_disposable_email
                BEFORE INSERT ON public.users
                FOR EACH ROW EXECUTE FUNCTION public.adsops_guard_user_signup_email()
            """.strip(),
        )
        for stmt in stmts:
            op.execute(sa.text(stmt))
        return

    insp = sa.inspect(bind)
    user_cols = {c["name"] for c in insp.get_columns("users")}
    if "email_verified" not in user_cols:
        op.add_column("users", sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.true()))
    if "email_verified_at" not in user_cols:
        op.add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
    if "failed_login_count" not in user_cols:
        op.add_column("users", sa.Column("failed_login_count", sa.Integer(), nullable=False, server_default="0"))
    if "login_locked_until" not in user_cols:
        op.add_column("users", sa.Column("login_locked_until", sa.DateTime(timezone=True), nullable=True))

    tables = set(insp.get_table_names())
    if "email_verification_tokens" not in tables:
        op.create_table(
            "email_verification_tokens",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("email", sa.String(length=320), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("requested_ip_hash", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token_hash", name="uq_email_verification_tokens_hash"),
        )
        op.create_index("ix_email_verification_tokens_user_id", "email_verification_tokens", ["user_id"])

    if "signup_email_allowlist" not in tables:
        op.create_table(
            "signup_email_allowlist",
            sa.Column("email", sa.String(length=320), nullable=False),
            sa.Column("note", sa.String(length=240), nullable=False, server_default=""),
            sa.Column("created_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("email"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    dialect_name = getattr(getattr(bind, "dialect", None), "name", "")
    if dialect_name == "postgresql":
        op.execute(sa.text("DROP TRIGGER IF EXISTS on_users_block_disposable_email ON public.users"))
        op.execute(sa.text("DROP FUNCTION IF EXISTS public.adsops_guard_user_signup_email()"))
    op.drop_table("signup_email_allowlist")
    op.drop_index("ix_email_verification_tokens_user_id", table_name="email_verification_tokens")
    op.drop_table("email_verification_tokens")
    op.drop_column("users", "login_locked_until")
    op.drop_column("users", "failed_login_count")
    op.drop_column("users", "email_verified_at")
    op.drop_column("users", "email_verified")
