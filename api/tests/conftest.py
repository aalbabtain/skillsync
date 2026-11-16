import pytest

from app import main


@pytest.fixture(autouse=True)
def fresh_rate_limiter():
    """Each test starts with a full allowance, so route tests never trip the limit."""
    main.rate_limiter.reset()
    yield
