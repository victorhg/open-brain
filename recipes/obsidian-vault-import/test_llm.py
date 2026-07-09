import os
import requests

# Load .env (basic parser)
if os.path.exists(".env"):
    with open(".env", "r") as f:
        for line in f:
            if "=" in line and not line.startswith("#"):
                key, val = line.strip().split("=", 1)
                os.environ[key] = val

base_url = os.environ.get("LOCAL_LLM_BASE_URL", "").rstrip("/")
embedding_model = os.environ.get("LOCAL_EMBEDDING_MODEL")
chat_model = os.environ.get("LOCAL_CHAT_MODEL")

print(f"Testing OMLX at: {base_url}")
headers = {"Authorization": "Bearer local", "Content-Type": "application/json"}

# Test 1: Chat Completion
try:
    print("Testing Chat Completion...", end=" ")
    resp = requests.post(
        f"{base_url}/chat/completions",
        headers=headers,
        json={
            "model": chat_model,
            "messages": [{"role": "user", "content": "Hello, are you working?"}],
            "max_tokens": 50
        },
        timeout=10
    )
    resp.raise_for_status()
    print("SUCCESS")
    print(f"Response: {resp.json()['choices'][0]['message']['content']}")
except Exception as e:
    print(f"FAILED: {e}")

# Test 2: Embedding
try:
    print("Testing Embeddings...", end=" ")
    resp = requests.post(
        f"{base_url}/embeddings",
        headers=headers,
        json={
            "model": embedding_model,
            "input": "test embedding"
        },
        timeout=10
    )
    resp.raise_for_status()
    print("SUCCESS")
    print(f"Embedding length: {len(resp.json()['data'][0]['embedding'])}")
except Exception as e:
    print(f"FAILED: {e}")
