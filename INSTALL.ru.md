# Установка и запуск

Одна инструкция для Windows, macOS и Linux.

Требования: Node.js 22.15 или новее, npm и git для установки с GitHub. OpenCode не обязателен.

## 1. Проверьте Node.js

Выполните в любом терминале:

```bash
node --version
npm --version
```

Первое число должно быть 22.15 или больше.

Если Node нет или версия старая:

- Windows: `winget install OpenJS.NodeJS.LTS`
- macOS: `brew install node` или установка через nvm
- Linux: установите Node через nvm или пакетный менеджер. Пакеты из дистрибутива часто слишком старые.

Установщик Node можно взять на [nodejs.org](https://nodejs.org/).

## 2. Установите пакет

Команда одинаковая для Windows, macOS и Linux:

```bash
npm install -g github:Closegamer/prompt-anonymizer
prompt-anonymizer --version
```

Если git недоступен, используйте архив:

```bash
npm install -g https://github.com/Closegamer/prompt-anonymizer/archive/refs/heads/main.tar.gz
```

## 3. Выберите способ использования

### A. OpenCode (рекомендуется)

```bash
prompt-anonymizer install
```

Команда добавляет плагин в `~/.config/opencode/opencode.json` и создаёт резервную копию `opencode.json.before-prompt-anonymizer.bak`. OpenCode перезагружает плагины автоматически. Начните новую сессию OpenCode.

Плагин запускает прокси и направляет через него OpenAI, Anthropic, DeepSeek, Google Gemini, OpenRouter, Groq, Mistral и xAI. Локальные провайдеры, например Ollama, не затрагиваются. Второй экземпляр прокси вручную запускать не нужно.

### B. Любой другой клиент

Запустите прокси в терминале и оставьте его работать:

```bash
prompt-anonymizer
```

В другом терминале укажите в клиенте соответствующий базовый URL:

| Провайдер | Базовый URL |
| --- | --- |
| OpenAI | `http://127.0.0.1:8787/openai/v1` |
| Anthropic | `http://127.0.0.1:8787/anthropic` |
| DeepSeek | `http://127.0.0.1:8787/deepseek/v1` |
| Google Gemini | `http://127.0.0.1:8787/gemini` |
| OpenRouter | `http://127.0.0.1:8787/openrouter/v1` |
| Groq | `http://127.0.0.1:8787/groq/openai/v1` |
| Mistral | `http://127.0.0.1:8787/mistral/v1` |
| xAI | `http://127.0.0.1:8787/xai/v1` |

Клиенты, совместимые с OpenAI, обычно принимают переменную окружения:

```bash
# macOS и Linux
export OPENAI_BASE_URL=http://127.0.0.1:8787/openai/v1
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787/anthropic
```

```powershell
# Windows PowerShell
$env:OPENAI_BASE_URL = "http://127.0.0.1:8787/openai/v1"
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:8787/anthropic"
```

Пример для Claude Code:

```bash
# macOS и Linux
ANTHROPIC_BASE_URL=http://127.0.0.1:8787/anthropic claude

# Windows PowerShell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:8787/anthropic"
claude
```

Клиент продолжает использовать свой API-ключ. Прокси передаёт заголовки авторизации дальше и не сохраняет их.

## 4. Проверка

Откройте проверку состояния:

```bash
# macOS и Linux
curl http://127.0.0.1:8787/health
```

```powershell
# Windows PowerShell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/health
```

Вы должны увидеть JSON с `"service":"prompt-anonymizer"` и `"ok":true`.

Затем отправьте обычный запрос через клиент. Первый запрос с именем может задержаться, пока скачиваются локальные NER-модели. Последующие запросы быстрее.

## 5. Остановка, обновление, удаление

Остановить прокси:

```bash
prompt-anonymizer stop
```

Обновить:

```bash
npm install -g github:Closegamer/prompt-anonymizer
prompt-anonymizer stop
```

Затем запустите прокси снова или начните новую сессию OpenCode.

Удалить:

```bash
prompt-anonymizer stop
npm uninstall -g prompt-anonymizer
```

После этого удалите путь к плагину из `~/.config/opencode/opencode.json`. Резервная копия, созданная установщиком, лежит рядом.

## Особенности ОС

### Windows

- Конфиг OpenCode: `%USERPROFILE%\.config\opencode\opencode.json`
- Глобальные бинарники npm: `%APPDATA%\npm`. Добавьте этот путь в `PATH`, если команда `prompt-anonymizer` не находится.
- Если PowerShell отказывается запускать `npm.ps1`, используйте `npm.cmd` или настройте политику выполнения для пользователя.
- CLI автоматически использует хранилище сертификатов Windows. Это помогает за корпоративным TLS-прокси.
- Проверка: `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/health`
- Остановить процесс по PID при необходимости: `Stop-Process -Id <pid>`

### macOS

- Конфиг OpenCode: `~/.config/opencode/opencode.json`
- Если глобальная установка npm падает с `EACCES`, используйте nvm или пользовательский npm prefix.
- За корпоративным TLS-прокси задайте `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` перед запуском прокси.
- Проверка: `curl http://127.0.0.1:8787/health`

### Linux

- Конфиг OpenCode: `~/.config/opencode/opencode.json`
- Рекомендуется nvm, потому что версия Node в репозиториях дистрибутива может быть старше 22.15.
- За корпоративным TLS-прокси задайте `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` перед запуском прокси.
- Проверка: `curl http://127.0.0.1:8787/health`

## Решение проблем

**`prompt-anonymizer: command not found`**

Каталог глобальных бинарников npm не в `PATH`. Проверьте его командой `npm config get prefix`. В Windows это обычно `%APPDATA%\npm`. В macOS и Linux это обычно `<prefix>/bin`.

**`EADDRINUSE`**

Порт 8787 уже занят. Выполните `prompt-anonymizer stop` или запустите на другом порту:

```bash
prompt-anonymizer --port 8788
```

Затем используйте новый порт в базовом URL клиента. Плагин OpenCode использует порт 8787, если не передать `options.port` в записи плагина.

**HTTP 415 от прокси**

Тело запроса не является JSON. Прокси по умолчанию блокирует непроверенные тела. Если вы понимаете риск, запустите его с `--allow-unscanned`.

**Плагин OpenCode не загружается**

Запустите `prompt-anonymizer install` ещё раз и проверьте, что путь существует. Если конфиг в формате JSONC, установщик не может изменить его автоматически. Добавьте напечатанный путь к плагину в массив `plugins` вручную и начните новую сессию.

**Не скачиваются модели**

При первом использовании NER скачиваются веса с `huggingface.co`. Проверьте сеть и корпоративный TLS-прокси. Можно запустить с `--no-ner`, чтобы использовать только регулярные детекторы.

**Посмотреть логи**

Запустите прокси вручную, без `--no-log`, и смотрите вывод в терминале:

```bash
prompt-anonymizer
```

writtenBy('Closegamer', 2026)
