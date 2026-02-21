# Z.AI Commit

AI-powered conventional commit message generator using Z.AI GLM-4.7-flash — right from the Source Control panel.

![VS Code](https://img.shields.io/badge/VS%20Code-1.85+-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **One-click generation** — Z icon in the Source Control title bar
- **Cancel anytime** — click the stop icon to abort generation mid-flight
- **Conventional commits** — `feat:`, `fix:`, `refactor:`, `chore:`, etc.
- **Staged + unstaged** — uses staged changes first, falls back to unstaged
- **Fast** — powered by `glm-4.7-flash`
- **Secure** — API key stored in VS Code's encrypted secret storage
- **Zero dependencies** — native `fetch`, no bloated SDKs

## Usage

1. Make changes to your code
2. Open Source Control panel (`Ctrl+Shift+G`)
3. Click the **Z** icon in the panel header
4. On first use, enter your Z.AI API key when prompted
5. Commit message appears in the input box

To cancel a running generation, click the **stop** icon that replaces the Z icon during generation.

## Commands

| Command | Description |
|---------|-------------|
| `Z.AI: Generate Commit Message (GLM)` | Generate a commit message from current changes |
| `Z.AI: Stop GLM Generation` | Cancel running generation |
| `Z.AI: Set Z.AI API Key` | Set or update your API key |
| `Z.AI: Clear Z.AI API Key` | Remove stored API key |

## Getting an API Key

1. Go to [z.ai](https://z.ai)
2. Sign up or log in
3. Navigate to API settings
4. Copy your API key
5. Use `Z.AI: Set Z.AI API Key` command or click the generate button (it will prompt automatically)

## How It Works

1. Reads `git diff` (staged changes preferred, unstaged as fallback)
2. Sends the diff to Z.AI's `glm-4.7-flash` model
3. Model generates a conventional commit message
4. Message is inserted into the SCM commit input box

## License

MIT
