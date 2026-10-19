"""Shared pytest fixtures for the AvaLab API test suite."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from avalab_api.main import create_app


@pytest.fixture()
def client() -> Iterator[TestClient]:
    """TestClient bound to a freshly created app instance."""
    with TestClient(create_app()) as test_client:
        yield test_client
