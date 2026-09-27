import json
import logging
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import diagnostics
from app.main import app
from app.routers import diagnostics as diagnostics_router


class DiagnosticsTest(unittest.TestCase):
    def _logger(self, folder, secrets=()):
        logger = logging.getLogger("diagnostics-test-" + folder)
        logger.propagate = False
        logger.setLevel(logging.INFO)
        handlers = diagnostics.file_handlers(Path(folder), logging.INFO, secrets)
        for handler in handlers:
            logger.addHandler(handler)
        return logger, handlers

    def _close(self, logger, handlers):
        for handler in handlers:
            logger.removeHandler(handler)
            handler.close()

    def test_activity_and_error_files_are_json_lines_with_trace_and_traceback(self):
        with tempfile.TemporaryDirectory() as folder:
            logger, handlers = self._logger(folder)
            token = diagnostics.set_trace("job-abc")
            try:
                logger.info("stage done")
                try:
                    raise ValueError("boom")
                except ValueError:
                    logger.error("stage failed", exc_info=True)
            finally:
                diagnostics.reset_trace(token)
                self._close(logger, handlers)
            activity = [json.loads(line) for line in (Path(folder) / "activity.log").read_text(encoding="utf-8").splitlines()]
            errors = [json.loads(line) for line in (Path(folder) / "errors.log").read_text(encoding="utf-8").splitlines()]
            self.assertEqual([e["msg"] for e in activity], ["stage done", "stage failed"])
            self.assertEqual([e["msg"] for e in errors], ["stage failed"])  # errors.log holds warnings+ only
            self.assertTrue(all(e["trace"] == "job-abc" for e in activity))
            self.assertIn("ValueError: boom", errors[0]["exc"])

    def test_secrets_never_reach_the_log_files(self):
        key = "sk-live-secret-key-1234567890"
        with tempfile.TemporaryDirectory() as folder:
            logger, handlers = self._logger(folder, secrets=[key, "service-token-abcdef"])
            logger.error("calling with %s and Authorization: Bearer abc.def-123 token=service-token-abcdef", key)
            self._close(logger, handlers)
            text = (Path(folder) / "errors.log").read_text(encoding="utf-8")
        for secret in (key, "abc.def-123", "service-token-abcdef"):
            self.assertNotIn(secret, text)
        self.assertIn("[redacted]", text)

    def test_tail_filters_by_trace_and_limits_lines(self):
        with tempfile.TemporaryDirectory() as folder:
            logger, handlers = self._logger(folder)
            for trace, n in (("req-1", 3), ("req-2", 2)):
                token = diagnostics.set_trace(trace)
                for i in range(n):
                    logger.info("line %d", i)
                diagnostics.reset_trace(token)
            self._close(logger, handlers)
            self.assertEqual(len(diagnostics.tail(Path(folder), "activity", 100, "req-1")), 3)
            self.assertEqual([e["msg"] for e in diagnostics.tail(Path(folder), "activity", 2)], ["line 0", "line 1"])
            self.assertEqual(diagnostics.tail(Path(folder), "errors", 10), [])

    def test_log_endpoint_requires_the_service_token(self):
        settings = SimpleNamespace(sourcing_api_token="operator-token-123", require_api_token=True)
        with tempfile.TemporaryDirectory() as folder, patch("app.auth.get_settings", return_value=settings), \
                patch.object(diagnostics_router, "get_settings", return_value=SimpleNamespace(log_path=Path(folder))):
            client = TestClient(app)
            self.assertEqual(client.get("/api/v1/diagnostics/logs").status_code, 401)
            ok = client.get("/api/v1/diagnostics/logs?file=activity", headers={"Authorization": "Bearer operator-token-123"})
            self.assertEqual((ok.status_code, ok.json()["file"]), (200, "activity"))


if __name__ == "__main__":
    unittest.main()
