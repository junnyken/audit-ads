"""A7 response schemas — Account Operations Intelligence. Read-only; no request body carries a
mutation here beyond the existing account list filters."""
from __future__ import annotations

import uuid
from datetime import datetime

from app.schemas.common import ORMModel


class OperationsOverviewOut(ORMModel):
    total_accounts: int
    archived_accounts: int
    by_status: dict[str, int]
    by_activity: dict[str, int]
    accounts_with_open_critical_alerts: int
    currencies_in_use: list[str]
    spend_total_by_currency: None = None


class BusinessManagerOperationsOut(ORMModel):
    business_manager_id: uuid.UUID
    business_manager_name: str
    account_count: int
    by_status: dict[str, int]
    by_activity: dict[str, int]
    open_critical_alerts: int
    open_warning_alerts: int
    last_data_update: datetime | None
    spend_today: None = None
    spend_last_7_days: None = None
    spend_current_month: None = None


class AccountOperationsRowOut(ORMModel):
    id: uuid.UUID
    display_name: str
    business_manager_name: str | None
    status: str
    readiness_status: str
    health_status: str
    activity_status: str
    data_freshness: str
    open_alert_count: int
    open_critical_alert_count: int
    currency: str | None
    last_activity_at: datetime | None
    updated_at: datetime
    spend_today: None = None
    spend_last_7_days: None = None
    spend_current_month: None = None
