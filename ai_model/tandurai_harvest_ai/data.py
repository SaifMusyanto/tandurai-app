"""Dataset loading, validation, and leakage-safe temporal splitting."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from .config import FEATURE_COLUMNS, GROUP_COLUMN, TARGET_COLUMN, TIME_COLUMN


@dataclass(frozen=True)
class TemporalSplit:
    train: pd.DataFrame
    validation: pd.DataFrame
    test: pd.DataFrame
    train_end: pd.Timestamp
    validation_end: pd.Timestamp


def load_model_table(path: str | Path) -> pd.DataFrame:
    df = pd.read_csv(path, parse_dates=[TIME_COLUMN])
    required = set(FEATURE_COLUMNS + [TARGET_COLUMN, TIME_COLUMN, GROUP_COLUMN])
    missing = sorted(required.difference(df.columns))
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    df = df.sort_values([TIME_COLUMN, GROUP_COLUMN]).reset_index(drop=True)
    return df


def temporal_split(
    df: pd.DataFrame,
    train_ratio: float = 0.70,
    validation_ratio: float = 0.15,
) -> TemporalSplit:
    dates = pd.Series(sorted(df[TIME_COLUMN].dropna().unique()))
    if len(dates) < 30:
        raise ValueError("At least 30 unique dates are required for temporal validation")
    train_idx = max(1, int(len(dates) * train_ratio)) - 1
    val_idx = max(train_idx + 1, int(len(dates) * (train_ratio + validation_ratio))) - 1
    train_end = pd.Timestamp(dates.iloc[train_idx])
    validation_end = pd.Timestamp(dates.iloc[min(val_idx, len(dates) - 2)])

    train = df[df[TIME_COLUMN] <= train_end].copy()
    validation = df[(df[TIME_COLUMN] > train_end) & (df[TIME_COLUMN] <= validation_end)].copy()
    test = df[df[TIME_COLUMN] > validation_end].copy()
    if min(len(train), len(validation), len(test)) == 0:
        raise ValueError("Temporal split produced an empty partition")
    return TemporalSplit(train, validation, test, train_end, validation_end)

