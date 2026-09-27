"""Local integration harness with recorded research and no external data calls.
Never used by Docker/Render; serves real FastAPI orchestration/cache/verification
and talks only to the local Java service for structured scoring.
"""
import os
import tempfile
from unittest.mock import patch
import uvicorn
from recorded_client import RecordedClient

if __name__=="__main__":
    with tempfile.TemporaryDirectory() as folder:
        os.environ.update(ALLOW_PAID_RESEARCH="true", ENABLE_WEB_SEARCH="true", STORAGE_DIR=folder,
                          SOURCING_API_TOKEN="integration-test-token", OPENAI_API_KEY="offline-test-only",
                          MODEL_API_URL="http://127.0.0.1:8080", MODEL_API_TOKEN="")
        from app.services import openai_client, registries, sector_context
        print("OFFLINE INTEGRATION HARNESS: recorded sources, not live research",flush=True)
        with patch.object(openai_client,"get_client",return_value=RecordedClient()), \
             patch.object(registries,"supported",return_value=False), \
             patch.object(registries,"adapter_for",return_value=None), \
             patch.object(sector_context,"get",return_value={"available":False}):
            uvicorn.run("app.main:app",host="127.0.0.1",port=8001)
