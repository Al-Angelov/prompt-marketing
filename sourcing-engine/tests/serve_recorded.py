"""Local integration harness. Only the external OpenAI transport is recorded.
Never used by Docker/Render; serves real FastAPI orchestration/cache/verification.
"""
import os
import tempfile
from unittest.mock import patch
import uvicorn
from recorded_client import RecordedClient

if __name__=="__main__":
    with tempfile.TemporaryDirectory() as folder:
        os.environ.update(ALLOW_PAID_RESEARCH="true", STORAGE_DIR=folder,SOURCING_API_TOKEN="integration-test-token",OPENAI_API_KEY="offline-test-only")
        from app.services import openai_client
        print("OFFLINE INTEGRATION HARNESS: recorded sources, not live research",flush=True)
        with patch.object(openai_client,"get_client",return_value=RecordedClient()):
            uvicorn.run("app.main:app",host="127.0.0.1",port=8001)
