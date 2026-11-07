## kitsu

kitsu is a self-hosted chat application for local models. It provides a web frontend and a backend API that handles authentication, chat history and tool calls. Inference runs on [llama-manager](https://github.com/wadealexc/llama-manager), usually on a separate GPU machine.

**Features:**
- **Wake-on-keystroke** — when a user starts typing, the backend asks llama-manager to start loading the selected model. llama-manager handles loading, swapping and sleeping models.
- **Tools from MCP servers** — admins add MCP servers (for example [si-web-extract](https://github.com/wadealexc/si-web-extract) for web search and page loading); users turn each server's tools on or off per chat
- **File uploads** — supports PDF, JSON, text, and image uploads in chat

### Important

This is a hobby project, use at your own risk. This codebase makes a lot of assumptions that pertain to my personal setup:
* OS: Ubuntu Server 24
* GPU: NVIDIA GeForce RTX 5090
* Preferred models: Qwen3.5-27B, Qwen3.5-35B-A3B

---

### Setup

#### Clone and install dependencies

```sh
git clone --recurse-submodules https://github.com/wadealexc/kitsu
cd kitsu
npm run install:all
```

The `llama-manager` submodule is only needed if you run llama-manager on the same machine; see its README for setup.

#### Configure

```sh
cp config.example.json config.json
```

Edit `config.json` — at minimum, set `llamaManager.url` and the models to offer. See [Configuration](#configuration) below.

TODO: add a script to automate creation of config.json from config.example.json 

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

**`llamaManager`** — where llama-manager is running:
```json
"llamaManager": {
    "url": "http://192.168.87.30:10001"
}
```

**`models`** — the models to offer users, by the name llama-manager serves them under, with optional inference defaults:
```json
"models": {
    "models": [
        { "alias": "my-model", "params": { "temperature": 0.7 } }
    ]
}
```

**`ports`** — host/port for the backend:
```json
"ports": {
    "backend": { "port": 8071, "host": "0.0.0.0" }
}
```

#### Tools

Models get their tools from MCP servers (Streamable HTTP). An admin adds them in **Admin → Tools** with a name, URL and optional bearer token; the token is stored in the database and never sent back to the browser.

Every tool of every enabled server is offered on every request, and users turn servers on or off per chat. Turning a server off doesn't change the tool list or system prompt, which would make the model process the whole conversation again. Instead kitsu adds a note for the model to the end of the next message, inside `<kitsu-note>` tags that the system prompt explains, and answers any call to a turned-off tool with an error.
