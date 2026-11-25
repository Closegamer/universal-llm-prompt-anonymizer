# Install Universal LLM Prompt Anonymizer

One guide for Windows, macOS and Linux. The product name is Universal LLM Prompt Anonymizer. The command is `prompt-anonymizer`.

**Disclaimer.** This is a best-effort privacy tool. It can fail to detect personal data, and the author is not liable for any data leak or damage. Use it at your own risk.

## Desktop app

The easiest option is the desktop app. It does not need Node.js, npm or git.

Download the installer from [Releases](https://github.com/Closegamer/universal-llm-prompt-anonymizer/releases/latest):

| OS | File |
| --- | --- |
| Windows x64 | `universal-llm-prompt-anonymizer-*-win-x64.exe` |
| macOS Apple Silicon | `universal-llm-prompt-anonymizer-*-mac-arm64.dmg` |
| Linux x64 | `.AppImage` or `.deb` |

Run the installer and start the app. It lives in the system tray and starts the proxy on `127.0.0.1:8787`.

Open the settings window from the tray:

- **What to hide:** names, nicknames, dates of birth, usernames, emails, phones, addresses, cards, IBANs, SSNs, account IDs, long numbers and IP addresses.
- **Behavior:** start at login, preload name models, write a request log, allow unscanned non-JSON bodies.
- **Advanced:** proxy port.

If you want dates to pass through, uncheck **Dates of birth** and press **Save and restart**. The same checkboxes control the proxy used by OpenCode.

The installers are not code signed. On Windows, choose **More info** then **Run anyway** if SmartScreen appears. On macOS, right-click the app and choose **Open**, or run:

```bash
xattr -dr com.apple.quarantine "/Applications/Universal LLM Prompt Anonymizer.app"
```

## Command line and OpenCode

Use this path if you want the CLI, the OpenCode plugin, or a custom integration. Do not run it on the same port as the desktop app.

Requirements: Node.js 22.15 or newer, npm, and git for the GitHub install.

## 1. Check Node.js

Run this in any terminal:

```bash
node --version
npm --version
```

The first number must be 22.15 or higher.

If Node is missing or too old:

- Windows: `winget install OpenJS.NodeJS.LTS`
- macOS: `brew install node` or install Node with nvm
- Linux: install Node with nvm or your package manager. Distribution packages are often too old.

Get Node from [nodejs.org](https://nodejs.org/) if you prefer the installer.

## 2. Install the package

This command is the same on Windows, macOS and Linux:

```bash
npm install -g github:Closegamer/universal-llm-prompt-anonymizer
prompt-anonymizer --version
```

If git is not available, use the tarball instead:

```bash
npm install -g https://github.com/Closegamer/universal-llm-prompt-anonymizer/archive/refs/heads/main.tar.gz
```

## 3. Choose how to use it

### A. OpenCode (recommended)

```bash
prompt-anonymizer install
```

The command adds the plugin to `~/.config/opencode/opencode.json` and creates a backup named `opencode.json.before-prompt-anonymizer.bak`. OpenCode reloads plugins automatically. Start a new OpenCode session.

The plugin starts the proxy and routes OpenAI, Anthropic, DeepSeek, Google Gemini, OpenRouter, Groq, Mistral and xAI through it. Local providers such as Ollama are left alone. You do not need to start a second proxy manually.

### B. Any other client

Start the proxy in a terminal and leave it running:

```bash
prompt-anonymizer
```

In another terminal, point the client at the matching base URL:

| Provider | Base URL |
| --- | --- |
| OpenAI | `http://127.0.0.1:8787/openai/v1` |
| Anthropic | `http://127.0.0.1:8787/anthropic` |
| DeepSeek | `http://127.0.0.1:8787/deepseek/v1` |
| Google Gemini | `http://127.0.0.1:8787/gemini` |
| OpenRouter | `http://127.0.0.1:8787/openrouter/v1` |
| Groq | `http://127.0.0.1:8787/groq/openai/v1` |
| Mistral | `http://127.0.0.1:8787/mistral/v1` |
| xAI | `http://127.0.0.1:8787/xai/v1` |

OpenAI-compatible clients usually accept an environment variable:

```bash
# macOS and Linux
export OPENAI_BASE_URL=http://127.0.0.1:8787/openai/v1
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787/anthropic
```

```powershell
# Windows PowerShell
$env:OPENAI_BASE_URL = "http://127.0.0.1:8787/openai/v1"
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:8787/anthropic"
```

Claude Code example:

```bash
# macOS and Linux
ANTHROPIC_BASE_URL=http://127.0.0.1:8787/anthropic claude

# Windows PowerShell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:8787/anthropic"
claude
```

The client keeps using its own API key. The proxy forwards authentication headers and does not store them.

## 4. Verify

Open the health endpoint:

```bash
# macOS and Linux
curl http://127.0.0.1:8787/health
```

```powershell
# Windows PowerShell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/health
```

You should see JSON with `"service":"universal-llm-prompt-anonymizer"` and `"ok":true`.

Then send a normal prompt through the client. A first request that contains a name can pause while the local NER weights download. Later requests are fast.

## 5. Stop, update, uninstall

Stop the proxy:

```bash
prompt-anonymizer stop
```

Update:

```bash
npm install -g github:Closegamer/universal-llm-prompt-anonymizer
prompt-anonymizer stop
```

Start it again, or start a new OpenCode session.

Uninstall:

```bash
prompt-anonymizer stop
npm uninstall -g universal-llm-prompt-anonymizer
```

Then remove the plugin path from `~/.config/opencode/opencode.json`. The backup file created by the installer is next to it.

## OS notes

### Windows

- OpenCode config: `%USERPROFILE%\.config\opencode\opencode.json`
- Global npm binaries: `%APPDATA%\npm`. Add it to `PATH` if `prompt-anonymizer` is not found.
- If PowerShell refuses to run `npm.ps1`, use `npm.cmd` instead, or set the execution policy for your user.
- The CLI automatically adds the Windows system certificate store, which helps behind a corporate TLS inspection proxy.
- Health check: `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/health`
- Stop a process by PID if needed: `Stop-Process -Id <pid>`

### macOS

- OpenCode config: `~/.config/opencode/opencode.json`
- If global npm install fails with `EACCES`, use nvm or configure a user-level npm prefix.
- Behind a corporate TLS proxy, set `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` before starting the proxy.
- Health check: `curl http://127.0.0.1:8787/health`

### Linux

- OpenCode config: `~/.config/opencode/opencode.json`
- nvm is recommended because distribution Node packages can be older than 22.15.
- Behind a corporate TLS proxy, set `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` before starting the proxy.
- Health check: `curl http://127.0.0.1:8787/health`

## Troubleshooting

**`prompt-anonymizer: command not found`**

The npm global bin directory is not on `PATH`. Check it with `npm config get prefix`. On Windows, the bin directory is usually `%APPDATA%\npm`. On macOS and Linux it is usually `<prefix>/bin`.

**`EADDRINUSE`**

Something is already listening on port 8787. Run `prompt-anonymizer stop`, or start with another port:

```bash
prompt-anonymizer --port 8788
```

Then use the new port in the client base URL. The OpenCode plugin uses port 8787 unless you pass `options.port` in the plugin entry.

**HTTP 415 from the proxy**

The request body was not JSON. The proxy blocks unscanned bodies by default. If you understand the risk, start it with `--allow-unscanned`.

**The OpenCode plugin does not load**

Run `prompt-anonymizer install` again and check that the path exists. If your config is JSONC, the installer cannot edit it automatically. Add the printed plugin path to the `plugins` array manually, then start a new session.

**Model download fails**

The first NER use downloads weights from `huggingface.co`. Check the network and any corporate TLS proxy. You can start with `--no-ner` to use only the regex detectors.

**See the logs**

Run the proxy manually, without `--no-log`, and watch the terminal:

```bash
prompt-anonymizer
```

writtenBy('Closegamer', 2026)
