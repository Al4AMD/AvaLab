"""Non-neural analysis tasks and their job-runner adapter."""

from collections.abc import Callable

import numpy as np

from avalab_api.ml.jobs import MlResult

RunFunction = Callable[
    [np.ndarray, int, dict[str, object], Callable[[float], None]],
    MlResult,
]


class FunctionRunner:
    """Adapt an ``analysis.<task>.run`` function to the job manager protocol."""

    def __init__(self, function: RunFunction) -> None:
        self._function = function

    def run(
        self,
        samples: np.ndarray,
        sample_rate_hz: int,
        params: dict[str, object],
        progress: Callable[[float], None],
    ) -> object:
        return self._function(samples, sample_rate_hz, params, progress)
