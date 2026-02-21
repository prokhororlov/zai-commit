import * as vscode from 'vscode';
import { ZaiApi } from './api';
import { getDiff, setCommitMessage } from './git';

const SECRET_KEY = 'zai-tools.apiKey';

const THINKING_WORDS = [
  'Reasoning...',
  'Analyzing...',
  'Pondering...',
  'Reflecting...',
  'Synthesizing...',
  'Considering...',
  'Examining...',
  'Evaluating...',
  'Deciphering...',
  'Contemplating...',
  'Interpreting...',
  'Distilling...',
];

const SPINNER = ['⠇', '⠋', '⠙', '⠸', '⢰', '⣠', '⣄', '⡆'];
const TYPE_SPEED = 60;
const ERASE_SPEED = 30;
const PAUSE_AFTER = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function startThinkingAnimation(set: (msg: string) => void): () => void {
  let stopped = false;
  let usedIndices: number[] = [];
  let spinFrame = 0;
  let currentText = '';

  const spinInterval = setInterval(() => {
    spinFrame++;
    set(`${SPINNER[spinFrame % SPINNER.length]} ${currentText}`);
  }, 80);

  function pickRandom(): string {
    if (usedIndices.length >= THINKING_WORDS.length) {
      usedIndices = [];
    }
    let idx: number;
    do {
      idx = Math.floor(Math.random() * THINKING_WORDS.length);
    } while (usedIndices.includes(idx));
    usedIndices.push(idx);
    return THINKING_WORDS[idx];
  }

  function render(text: string) {
    currentText = text;
  }

  async function loop() {
    while (!stopped) {
      const word = pickRandom();

      // Type in
      for (let i = 1; i <= word.length; i++) {
        if (stopped) { return; }
        render(word.slice(0, i));
        await sleep(TYPE_SPEED);
      }

      // Pause
      if (stopped) { return; }
      await sleep(PAUSE_AFTER);

      // Erase
      for (let i = word.length - 1; i >= 0; i--) {
        if (stopped) { return; }
        render(word.slice(0, i));
        await sleep(ERASE_SPEED);
      }

      if (stopped) { return; }
      render('');
      await sleep(100);
    }
  }

  loop();
  return () => {
    stopped = true;
    clearInterval(spinInterval);
  };
}

async function getOrPromptApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  let key = await secrets.get(SECRET_KEY);
  if (key) {
    return key;
  }

  key = await vscode.window.showInputBox({
    prompt: 'Enter your Z.AI API Key',
    password: true,
    placeHolder: 'your-api-key-here',
    ignoreFocusOut: true,
  });

  if (key) {
    await secrets.store(SECRET_KEY, key.trim());
  }
  return key?.trim();
}

export function activate(context: vscode.ExtensionContext) {
  const { secrets } = context;

  let currentApi: ZaiApi | null = null;
  let stopAnimation: (() => void) | null = null;

  function setGenerating(value: boolean) {
    vscode.commands.executeCommand('setContext', 'zaiGenerating', value);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('zai-tools.generateCommit', async () => {
      const apiKey = await getOrPromptApiKey(secrets);
      if (!apiKey) {
        return;
      }

      try {
        const diff = await getDiff();
        if (!diff) {
          vscode.window.showWarningMessage('No changes found. Make some changes first.');
          return;
        }

        setGenerating(true);
        stopAnimation = startThinkingAnimation((msg) => setCommitMessage(msg));

        try {
          currentApi = new ZaiApi(apiKey);
          const message = await currentApi.generateCommitMessage(diff);
          stopAnimation();
          stopAnimation = null;
          setGenerating(false);
          currentApi = null;
          await setCommitMessage(message);
        } catch (err: unknown) {
          stopAnimation?.();
          stopAnimation = null;
          setGenerating(false);
          currentApi = null;
          const msg = err instanceof Error ? err.message : String(err);

          if (msg.includes('abort') || msg.includes('AbortError')) {
            await setCommitMessage('');
            return;
          }

          await setCommitMessage('');

          if (msg.includes('401') || msg.includes('Unauthorized')) {
            await secrets.delete(SECRET_KEY);
            vscode.window.showErrorMessage('Invalid API key. It has been cleared — try again.');
          } else {
            vscode.window.showErrorMessage(`Failed to generate: ${msg}`);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to generate: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('zai-tools.stopGeneration', () => {
      currentApi?.abort();
      stopAnimation?.();
      stopAnimation = null;
      setGenerating(false);
      currentApi = null;
      setCommitMessage('');
    }),
  );

  // --- API Key Management ---

  context.subscriptions.push(
    vscode.commands.registerCommand('zai-tools.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your Z.AI API Key',
        password: true,
        placeHolder: 'your-api-key-here',
        ignoreFocusOut: true,
      });
      if (key) {
        await secrets.store(SECRET_KEY, key.trim());
        vscode.window.showInformationMessage('Z.AI API key saved.');
      }
    }),

    vscode.commands.registerCommand('zai-tools.clearApiKey', async () => {
      await secrets.delete(SECRET_KEY);
      vscode.window.showInformationMessage('Z.AI API key cleared.');
    }),
  );
}

export function deactivate() {}
