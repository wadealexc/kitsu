## llama-shim

`llama-shim` is a lightweight proxy that sits between Open WebUI (OWU) and llama.cpp's `llama-server`. `llama-shim` provides an "OpenAI-compatible API" to OWU, while extending the capabilities of llama.cpp to provide several features:
* **Model Swapping**
    * `llama-shim` tells OWU about any model located in the `/models` folder, and manages llama.cpp instances to serve each model when requested. This allows integration with the native model swapping already built into OWU.
* **Inactivity Timeout**
    * If the current model hasn't been used in the last 10 minutes, `llama-shim` kills its process to save energy.
* **Logging and Debugging**
    * `llama-shim` keeps chat logs and llama.cpp server logs to help with debugging

WIP features:
* **Version Management**
    * Keep submodules for llama.cpp and OWU to ensure `llama-shim` can easily update/roll back to compatible versions of both.
* **Tool Server**
    * Expose an OpenAPI tool server to use with OWU. Implement some basic tools (like web search)
    * Caching: adapt @aldehir's `gpt-oss-adapter` to manage CoT reasoning [link](github.com/aldehir/gpt-oss-adapter)

Misc backlog:
* Add to shim-config:
    * config server ports
    * chat logs on/off


### Important

This is a hobby project, use at your own risk. This codebase makes a lot of assumptions that pertain to my personal setup:
* Ubuntu Server 24
* Open WebUI frontend
* gpt-oss-20b

`llama-shim` may not work perfectly for all models - specifically, I haven't tried any image/file/multimodal features; I'm purely doing text. I am using the `ggml-org` GGUF: https://huggingface.co/ggml-org/gpt-oss-20b-GGUF.

---

### Prerequisites

* Typescript/Node/NVM
* Open WebUI

#### Build Llama.cpp submodule

cd into the `llama.cpp` submodule and build from source, following the instructions here: [ggml-org/llama.cpp/docs/build.md](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md).

If you want `llama-shim` to use an already-built binary:
* Make sure `llama-server` is in your `$PATH`
* Edit `shim-config.json`: `llamaServer.useSubmodule: false`
* For systemd, also edit `./run.sh` to place `llama-server` in your `$PATH`

---

### Connect to Open WebUI

Follow OWU's instructions for connecting to `llama-server`: https://docs.openwebui.com/getting-started/quick-start/starting-with-llama-cpp, but connect to your `llama-shim` instance, instead. `llama-shim` runs on port `8081`.

#### Making models visible to OWU

Move any GGUFs you want the shim to use into `llama-shim/models/`. You may use subfolders. The current config assumes you have `gpt-oss-20b-mxfp4.gguf` in the models folder already. If you use something different, update `defaultModelName` in `shim-config.json`.

---

### Running in the background (systemd)

`node/nvm` are designed to run in a TTY, so typically they'll close out if you exit your SSH session. To keep this running in the background, we need to create a systemd service. Follow these steps:

#### 1. Define the service

1. `sudo nano /etc/systemd/system/llama-shim.service`

In that file, place your service definition. Below is my file; you'll need to:
- replace `fox` with your username
- ensure `WorkingDirectory` points to the repository. (if you change this, also change `ExecStart`)


```
[Unit]
# start after network is up
Description=llama-server/owu shim
After=network.target

[Service]
# Run the `run.sh` script in the project root
# This script ensures `node` and `llama-server` are in our path
# when run by systemd
User=fox
WorkingDirectory=/home/fox/llama-shim
ExecStart=/home/fox/llama-shim/run.sh

# Shutdown behavior - kill parent process only
# (llama-shim will take care of child processes)
TimeoutStopSec=20
KillSignal=SIGINT
KillMode=process

# Restart policy
Restart=on-failure
RestartSec=10

# Send output to journal
#
# check status:
# systemctl status llama-shim
#
# view logs:
# journalctl -u llama-shim -f
StandardInput=null
#StandardOutput=append:/var/log/llama-shim.log
#StandardError=append:/var/log/llama-shim.err.log

[Install]
WantedBy=multi-user.target
```

2. Make `run.sh` (included in this repo) executable:

`chmod +x llama-shim/run.sh`

3. Ensure `run.sh` points to your `nvm` directory and includes `llama-server` in your `PATH`.

4. Build `llama-shim` so it can be run by node: `npm run build`

(Note, also make sure you've built the `llama.cpp` submodule if you're using that!)

#### 2. Reload systemctl and start the service

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now llama-shim
```

#### 3. View logs/status/shut down service

```sh
# check whether service is running
sudo systemctl status llama-shim

# view logs live in terminal
journalctl -u llama-shim -f -o cat

# shut down service
sudo systemctl stop llama-shim
```