"""Tests for the PII redactor — same patterns as the TypeScript SDK tests."""

from __future__ import annotations

from agentlens.redactor import maybe_redact, redact


class TestRedact:
    def test_redacts_email(self) -> None:
        result = redact("Contact us at user@example.com")
        assert result == "Contact us at [REDACTED-EMAIL]"

    def test_redacts_phone_number(self) -> None:
        result = redact("Call 415-555-1234 now")
        assert "[REDACTED-PHONE]" in result

    def test_redacts_ssn(self) -> None:
        result = redact("SSN: 123-45-6789")
        assert "[REDACTED-SSN]" in result

    def test_redacts_bearer_token(self) -> None:
        result = redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig")
        assert "[REDACTED-BEARER_TOKEN]" in result

    def test_redacts_api_key(self) -> None:
        result = redact("key_abcdefghijklmnopqrstuvwxyz12345")
        assert "[REDACTED-API_KEY]" in result

    def test_leaves_clean_text_unchanged(self) -> None:
        clean = "The weather today is sunny with a high of 25°C."
        assert redact(clean) == clean

    def test_redacts_multiple_pii_in_one_string(self) -> None:
        text = "email: a@b.com, phone: 555-123-4567, more: c@d.org"
        result = redact(text)
        assert "@" not in result
        assert "555-123-4567" not in result
        assert "[REDACTED-EMAIL]" in result
        assert "[REDACTED-PHONE]" in result

    def test_redacts_multiple_emails(self) -> None:
        text = "From: alice@a.com To: bob@b.com"
        result = redact(text)
        assert "alice@a.com" not in result
        assert "bob@b.com" not in result
        assert result.count("[REDACTED-EMAIL]") == 2


class TestMaybeRedact:
    def test_redacts_when_enabled(self) -> None:
        result = maybe_redact("email: test@test.com", enabled=True)
        assert result is not None
        assert "@" not in result

    def test_passes_through_when_disabled(self) -> None:
        text = "email: test@test.com"
        result = maybe_redact(text, enabled=False)
        assert result == text

    def test_returns_none_unchanged(self) -> None:
        assert maybe_redact(None, enabled=True) is None
        assert maybe_redact(None, enabled=False) is None

    def test_does_not_mutate_original(self) -> None:
        original = "email: test@test.com"
        copy = original
        maybe_redact(original, enabled=True)
        assert original == copy
