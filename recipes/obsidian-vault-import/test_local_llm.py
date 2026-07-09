import os
import requests
import json
from pathlib import Path

# Load env vars
env_file = Path(__file__).parent.parent.parent / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, _, value = line.partition('=')
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key.strip(), value)

LOCAL_LLM_ENDPOINT = os.environ.get("LOCAL_LLM_BASE_URL", "").rstrip('/')
LOCAL_LLM_MODEL = os.environ.get("LOCAL_CHAT_MODEL", "llama3")

LOCAL_API_KEY = os.environ.get("LOCAL_LLM_API", "")

def test_local_llm():
    print(f"Testing connection to local LLM at: {LOCAL_LLM_ENDPOINT}")
    print(f"Using model: {LOCAL_LLM_MODEL}")
    
    if not LOCAL_LLM_ENDPOINT:
        print("Error: LOCAL_LLM_BASE_URL is not set in .env")
        return

    try:
        url = f"{LOCAL_LLM_ENDPOINT}/chat/completions"
        headers = {"Authorization": f"Bearer {LOCAL_API_KEY}"} if LOCAL_API_KEY else {}
        payload = {
            "model": LOCAL_LLM_MODEL,
            "messages": [{"role": "user", "content": "Hello, are you working?"}],
            "temperature": 0.1
        }
        
        print(f"POST {url}")
        resp = requests.post(url, json=payload, headers=headers, timeout=30)
        resp.raise_for_status()
        
        data = resp.json()
        print("Success! Response:")
        print(data["choices"][0]["message"]["content"])
        
    except Exception as e:
        print(f"Connection failed: {e}")

if __name__ == "__main__":
    test_local_llm()
