"""Tree, quantile, and baseline models with consistent preprocessing."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingRegressor, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .config import CATEGORICAL_FEATURES, NUMERIC_FEATURES, QUANTILES, RANDOM_SEED


def make_preprocessor(scale_numeric: bool = False) -> ColumnTransformer:
    numeric_steps: list[tuple[str, Any]] = [("imputer", SimpleImputer(strategy="median"))]
    if scale_numeric:
        numeric_steps.append(("scaler", StandardScaler()))
    return ColumnTransformer(
        transformers=[
            ("numeric", Pipeline(numeric_steps), NUMERIC_FEATURES),
            (
                "categorical",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
                    ]
                ),
                CATEGORICAL_FEATURES,
            ),
        ],
        remainder="drop",
    )


def build_lightgbm() -> Pipeline:
    try:
        from lightgbm import LGBMRegressor
    except ImportError as exc:
        raise RuntimeError("Install lightgbm to run the exact LightGBM model") from exc
    model = LGBMRegressor(
        objective="regression_l1",
        n_estimators=800,
        learning_rate=0.03,
        num_leaves=31,
        max_depth=-1,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_alpha=0.1,
        reg_lambda=0.2,
        random_state=RANDOM_SEED,
        n_jobs=-1,
        verbosity=-1,
    )
    return Pipeline([("preprocess", make_preprocessor()), ("model", model)])


def build_xgboost() -> Pipeline:
    try:
        from xgboost import XGBRegressor
    except ImportError as exc:
        raise RuntimeError("Install xgboost to run the exact XGBoost model") from exc
    model = XGBRegressor(
        objective="reg:squarederror",
        n_estimators=800,
        learning_rate=0.03,
        max_depth=6,
        min_child_weight=5,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_alpha=0.1,
        reg_lambda=1.0,
        random_state=RANDOM_SEED,
        n_jobs=-1,
        tree_method="hist",
    )
    return Pipeline([("preprocess", make_preprocessor()), ("model", model)])


def build_reference_hist_gbm() -> Pipeline:
    """Dependency-light smoke-test model; never label its score as LightGBM."""
    model = HistGradientBoostingRegressor(
        loss="absolute_error",
        learning_rate=0.05,
        max_iter=400,
        max_leaf_nodes=31,
        l2_regularization=0.2,
        random_state=RANDOM_SEED,
    )
    return Pipeline([("preprocess", make_preprocessor()), ("model", model)])


def build_reference_gradient_boosting() -> Pipeline:
    """Dependency-light smoke-test model; never label its score as XGBoost."""
    model = GradientBoostingRegressor(
        loss="huber",
        n_estimators=400,
        learning_rate=0.035,
        max_depth=3,
        min_samples_leaf=8,
        random_state=RANDOM_SEED,
    )
    return Pipeline([("preprocess", make_preprocessor()), ("model", model)])


@dataclass
class QuantileBundle:
    models: dict[float, Pipeline]

    def fit(self, x, y) -> "QuantileBundle":
        for model in self.models.values():
            model.fit(x, y)
        return self

    def predict(self, x) -> dict[float, np.ndarray]:
        raw = {q: np.maximum(0.0, model.predict(x)) for q, model in self.models.items()}
        stacked = np.vstack([raw[q] for q in QUANTILES])
        monotonic = np.sort(stacked, axis=0)
        return {q: monotonic[i] for i, q in enumerate(QUANTILES)}


def build_quantile_regression() -> QuantileBundle:
    models: dict[float, Pipeline] = {}
    for q in QUANTILES:
        model = GradientBoostingRegressor(
            loss="quantile",
            alpha=q,
            n_estimators=450,
            learning_rate=0.035,
            max_depth=3,
            min_samples_leaf=10,
            random_state=RANDOM_SEED,
        )
        models[q] = Pipeline([("preprocess", make_preprocessor()), ("model", model)])
    return QuantileBundle(models)

