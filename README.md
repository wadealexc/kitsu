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

Edit `config.json` — at minimum, set `llamaManager.url`. See [Configuration](#configuration) below.

TODO: add a script to automate creation of config.json from config.example.json 

---

### Run (Prod)

kitsu runs as one container: the backend serves the API and the built frontend.

```sh
cp config.example.json config.json          # then edit
echo "WEBUI_SECRET_KEY=$(openssl rand -hex 32)" > .env
KITSU_VERSION=$(git rev-parse --short HEAD) docker compose up -d --build
```

The app is at `http://<host>:5050` and the API at `http://<host>:8071` (for other tools: `/api/v1/chat/completions` is OpenAI-compatible). The database and logs live in `backend/data` and `backend/logs`, and migrations run at startup. Put it behind an HTTPS reverse proxy: browsers keep the clipboard and some other features to secure pages, and the iOS home screen app needs it.

```sh
docker compose logs -f kitsu
docker compose restart kitsu
```

### Run (Dev)

```sh
docker compose stop     # if the container is running: dev mode uses the same ports and data
./scripts/dev.sh        # backend on :8071 (restarts on changes), frontend on :5050 (live reload)
```

`dev.sh` also starts a debug bridge: every page served by the dev server (including the iOS home screen app, through your HTTPS proxy) reports console output, errors and lifecycle events (backgrounding, suspend and resume, keyboard and viewport changes), and can be inspected and driven from this machine with `scripts/kdebug` (run it without arguments for usage).

For a one-tap sign-in button on the dev server's login page, put `VITE_DEV_LOGIN_USER` and `VITE_DEV_LOGIN_PASSWORD` in `frontend/.env.development.local` (git-ignored, dev builds only).

---

### Configuration

kitsu is configured via `config.json` at the repo root. Copy `config.example.json` as a starting point.

**`llamaManager`** — where llama-manager is running:
```json
"llamaManager": {
    "url": "http://192.168.87.30:10001"
}
```

Models aren't listed in the config: kitsu offers whatever llama-manager serves. Sampling defaults belong to the models users create in the Models page.

**`ports`** — host/port for the backend:
```json
"ports": {
    "backend": { "port": 8071, "host": "0.0.0.0" }
}
```

#### Tools

Models get their tools from MCP servers (Streamable HTTP). An admin adds them in **Admin → Tools** with a name, URL and optional bearer token; the token is stored in the database and never sent back to the browser.

Every tool of every enabled server is offered on every request, and users turn servers on or off per chat. Turning a server off doesn't change the tool list or system prompt, which would make the model process the whole conversation again. Instead kitsu adds a note for the model to the end of the next message, inside `<kitsu-note>` tags that the system prompt explains, and answers any call to a turned-off tool with an error.
