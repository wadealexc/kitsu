## llama-shim

`llama-shim` is a lightweight proxy that sits between Open WebUI (OWU) and llama.cpp's `llama-server`. `llama-shim` provides an "OpenAI-compatible API" to OWU, while extending the capabilities of llama.cpp to provide several features:
* **Model Swapping**
    * `llama-shim` tells OWU about any model located in the `/models` folder, and manages llama.cpp instances to serve each model when requested. This allows integration with the native model swapping already built into OWU.
* **Sleep Mode**
    * If the current model hasn't been used in the last 10 minutes, `llama-shim` kills its  `llama-server` process to save energy. `llama-shim` will start a new `llama-server` process when it next receives a message.
* **Logging and Debugging**
    * `llama-shim` keeps chat logs and `llama-server` logs to help with debugging
* **Version Management**
    * `llama-shim` uses a submodule for llama.cpp, and a `docker-compose.yml` file for OWU to ensure it runs alongside known-compatible versions of both.

WIP Features:
* Support embedding and reranking (and eventually a full RAG pipeline)
* Use an actual DB for logs, cached documents/web results, etc

TODO Chores:
* Support config for:
    * server ports
    * chat logs on/off/only on failure
* Better debug logs (named services + timestamps)

### Important

This is a hobby project, use at your own risk. This codebase makes a lot of assumptions that pertain to my personal setup:
* OS: Ubuntu Server 24
* GPU: NVIDIA GeForce RTX 5090 (32 GB VRAM)
* Frontend: Open WebUI
* Preferred models: gpt-oss-20b, Qwen3-VL-30B

### Contents

- [Quick Start](#quick-start-buildrunconnect-to-owu)
- [(OPTIONAL) Enable Web Search](#optional-enable-web-search-and-webpage-loading)
- [(OPTIONAL) Run via systemd](#optional-run-llama-shim-as-a-background-process-via-systemd)

---

### Quick Start: Build/Run/Connect to OWU

Prerequisites:
* Install Typescript, Node, and NVM
* Install docker and docker-compose
* Have some GGUFs ready!

<!-- edit `config.example.json` -->
<!-- ensure you can run `tsx` and `tsc` -->

#### 1. Build `llama.cpp` via submodule

First, move into the submodule directory: `cd llama.cpp`. Then, follow the "build from source" instructions on this page, depending on your machine: [ggml-org/llama.cpp/docs/build.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md).

For my system (NVIDIA GPU + CUDA toolkit installed), I use the commands in the [CUDA section](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md#cuda):

```sh
# dir: /llama-shim/llama.cpp
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release
```

#### 2. Start OWU

```sh
# dir: /llama-shim
docker compose up -d
```
<!-- TODO - default/example config -->
<!-- ### Connect to Open WebUI

Follow OWU's instructions for connecting to `llama-server`: https://docs.openwebui.com/getting-started/quick-start/starting-with-llama-cpp, but connect to your `llama-shim` instance, instead. `llama-shim` runs on port `8081`.

#### Making models visible to OWU

Move any GGUFs you want the shim to use into `llama-shim/models/`. You may use subfolders. The current config assumes you have `gpt-oss-20b-mxfp4.gguf` in the models folder already. If you use something different, update `defaultModelName` in `shim-config.json`. -->

#### 3. Add models

TODO

#### 4. Install `llama-shim` packages and run

```sh
# dir: /llama-shim
npm i
npm run dev
```

---

### (OPTIONAL) Enable web search and webpage loading

Prerequisites:
* [Brave search API key](https://api-dashboard.search.brave.com/app/plans)
* A willingness to sacrifice some RAM/CPU for better web results

`llama-shim` can act as a provider for web search and web page loading in Open WebUI. This means that when your models use OWU's 'web search' tool, `llama-shim` will perform the resulting web searches and load any resulting webpages. **Why?** Well, I noticed that OWU's default webpage loader struggles with many types of sites, failing to extract content because the page requires running javascript, or extracting a bunch of junk that isn't needed and ultimately clutters my LLM's context windows.

`llama-shim's` webpage loader uses [puppeteer](https://pptr.dev) to load webpages, and trims navbars, headers, and footers in an attempt to load only the "relevant content" of the page. So far, this seems to work much better than OWU's webpage loader, but I am new to puppeteer and 'scraping' generally, and there may be some cases/ways where this breaks. This feature will be improved over time as I use it (issues/PRs welcome!).

Also note that my search provider is currently Brave. I'd like to support different providers eventually, but it's not high on my priority list. If you're interested in the implementation, check `/browser`.

#### 1. Edit `config.json`

Paste your brave API key into `config.json`, and set `enable` to `true`:

```json
{
    "web": {
        "enable": true,
        "braveAPIKey": "YOUR_API_KEY",
        "runDangerouslyWithoutSandbox": false,  // if you want to try the feature out quickly
        "screenshotWebpages": false             // helpful for debugging
    },
    // ... rest of config follows
}
```

#### 2. Edit `docker-compose.yml`

TODO

#### 3. [Recommended] Set up browser sandbox

**If you want to try this feature out quickly** to see if setting up the sandbox is "worth it," you can edit the config option above (`runDangerouslyWithoutSandbox: true`), and it should 'just work.' But keep in mind that this will tell puppeteer to start chromium with `--no-sandbox`, which allows webpages to run arbitrary javascript on your system. If you do this, just use it for a quick trial run!

**If you want to use this feature safely**: this part will vary based on your OS and may require some troubleshooting if things don't work perfectly. I'm just going to detail the steps I took - sorry this isn't super user friendly!

Since I'm on Ubuntu, I followed these steps in the puppeteer docs ([troubleshooting/#using-setuid-sandbox](https://pptr.dev/troubleshooting#using-setuid-sandbox)):

```sh
# cd to Puppeteer cache directory (adjust the path if using a different cache directory).
cd ~/.cache/puppeteer/chrome/linux-<version>/chrome-linux64/
sudo chown root:root chrome_sandbox
sudo chmod 4755 chrome_sandbox
# copy sandbox executable to a shared location
sudo cp -p chrome_sandbox /usr/local/sbin/chrome-devel-sandbox
# export CHROME_DEVEL_SANDBOX env variable
export CHROME_DEVEL_SANDBOX=/usr/local/sbin/chrome-devel-sandbox
``` 

I also added that final line to my `~/.bashrc` (`export CHROME_DEVEL_SANDBOX=/usr/local/sbin/chrome-devel-sandbox`). The `./run.sh` script also has that line included so that `systemd` has the correct environment to run puppeteer.

#### 4. Run `llama-shim`

```sh
npm run dev
```

---

### (OPTIONAL) Run `llama-shim` as a background process via systemd

#### Prerequisites

* Ubuntu

`node/nvm` are designed to run in a TTY, so typically they'll close out if you exit your SSH/terminal session. To keep this running in the background, we need to create a systemd service. Follow these steps:

#### 1. Define the service

Create the service file:

```sh
sudo nano /etc/systemd/system/llama-shim.service
```

In that file, place your service definition. An example service file is included in this repo (see `/llama-shim.example.service`). You will need to:
* replace `YOUR_USER_HERE` with your username
* ensure `WorkingDirectory` and `ExecStart` point to this folder

#### 2. Make `./run.sh` executable

The example service file uses `./run.sh` to set up the correct environment and run `llama-shim`. You need to make it executable so that systemd can run it:

```sh
chmod +x llama-shim/run.sh
```

#### 3. Build `llama-shim` so it can be run by node

This ensures systemd can run `node dist/index.js`:

```sh
npm run build
```

#### 4. Reload systemctl and start the service

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now llama-shim
```

#### 5. View logs/status/shut down service

```sh
# check whether service is running
sudo systemctl status llama-shim

# view logs live in terminal
journalctl -u llama-shim -f -o cat

# shut down service
sudo systemctl stop llama-shim
```

---

<!-- ### Configuring `llama-shim`

`llama-shim` is configured via `config.json`, which (if needed) will be created for you from the template file `config.example.json`.

#### `llamaCpp`

```json
{
    "llamaCpp": {
        "useSubmodule": true,
        "sleepAfterXSeconds": 600
    },
    // ... rest of config follows
}
```

* `useSubmodule`:  -->