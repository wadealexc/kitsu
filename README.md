## kitsu

kitsu is a self-hosted chat application built on top of [llama.cpp](https://github.com/ggml-org/llama.cpp). It provides a web frontend and a backend API that manages llama.cpp processes, handles authentication, and runs tool calls.

**Features:**
- **Model management (sleep mode and wake-on-keystroke)** — define multiple models in `config.json`; kitsu serves them on demand and swaps between them automatically. Idle models are shut down after a configurable timeout to save system resources. When a user starts typing on the frontend, the backend begins waking up the selected model.
- **Web search and page loading** — uses Brave search + Playwright to give models access to the web
- **File uploads** — supports PDF, JSON, text, and image uploads in chat

### Important

This is a hobby project, use at your own risk. This codebase makes a lot of assumptions that pertain to my personal setup:
* OS: Ubuntu Server 24
* GPU: NVIDIA GeForce RTX 5090
* Preferred models: Qwen3.5-27B, Qwen3.5-35B-A3B

---

### Setup

#### Clone, Install Dependencies, Build Llama.cpp

```sh
git clone --recurse-submodules https://github.com/wadealexc/kitsu
cd kitsu

# Install deps
npm run install:all

# Build llama.cpp
cd llama.cpp
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release

cd ..
```

See [llama.cpp build docs](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md) for other configurations.

#### Configure

```sh
cp config.example.json config.json
```

Edit `config.json` — at minimum, set your model paths and ports. See [Configuration](#configuration) below.

TODO: add a script to automate creation of config.json from config.example.json 

#### Add models

Place GGUF files in the `models/` directory. Subdirectories are supported:

```
models/
  my-model/
    model-q6.gguf
    mmproj.gguf     # optional, for vision models
```

Then reference them in `config.json` under `models.models`.

TODO: add a script that auto-updates config.json as models are added to models

---

### Run (Quick Start)

```sh
npm run dev             # backend
npm run dev:frontend    # frontend
```

---

### Run (Prod)

Build the backend and install the systemd service:

```sh
npm run build
./install-service.sh
sudo systemctl enable --now kitsu
```

Start the frontend:

```sh
docker compose up -d
```

The frontend is available at `http://localhost:5050`.

Useful service commands:

```sh
systemctl status kitsu
journalctl -u kitsu -f -o cat
sudo systemctl stop kitsu
sudo systemctl restart kitsu
```

---

### Configuration

kitsu is configured via `config.json` at the repo root. Copy `config.example.json` as a starting point.

**`models`** — define models and the models directory:
```json
"models": {
    "path": "./models",
    "onStart": "my-model",
    "models": [
        {
            "gguf": "my-model/model-q6",
            "alias": "my-model",
            "args": ["--ctx-size", "32768"]
        }
    ]
}
```

**`ports`** — configure host/port for llama-server and the backend:
```json
"ports": {
    "llamaCpp": { "port": 8070, "host": "0.0.0.0" },
    "backend":  { "port": 8071, "host": "0.0.0.0" }
}
```

**`llamaCpp`** — sleep timeout:
```json
"llamaCpp": {
    "sleepAfterXSeconds": 600
}
```

#### Web

**`web`** — enable web search and page loading (requires a [Brave API key](https://api-dashboard.search.brave.com/app/plans)):
```json
"web": {
    "enable": true,
    "braveAPIKey": "YOUR_API_KEY",
    "blacklistHosts": ["grokipedia.com"]
}
```

`blacklistHosts` is an optional list of hostnames to exclude from web search results. Blacklisted hosts are never fetched. Defaults to `[]`.

After setting `enable: true`, install the Firefox browser for Playwright (one-time setup, run from the `backend/` directory):

```sh
cd backend && npx playwright install firefox
```
