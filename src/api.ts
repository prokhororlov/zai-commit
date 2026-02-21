const BASE_URL = 'https://api.z.ai/api/paas/v4/chat/completions';

const COMMIT_PROMPT = `You are a git commit message generator. Rules:
1. Use conventional commits format: type(scope): description
2. Types: feat, fix, refactor, chore, docs, style, test, perf, ci, build
3. Keep the subject line under 72 characters
4. Be concise — describe WHAT changed, not WHY
5. Use imperative mood: "add feature" not "added feature"
6. Output ONLY the commit message, nothing else — no explanation, no reasoning
7. If changes span multiple areas, use the most impactful type
8. For scope, use the main module/component affected`;

const MAX_DIFF_CHARS = 300000;

interface ZaiMessage {
  content?: string;
  reasoning_content?: string;
}

interface ZaiResponse {
  choices?: Array<{ message?: ZaiMessage; finish_reason?: string }>;
}

export class ZaiApi {
  private apiKey: string;
  private abortController: AbortController | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  private async call(
    messages: Array<{ role: string; content: string }>,
    options?: { maxTokens?: number; temperature?: number },
  ): Promise<string> {
    this.abortController = new AbortController();

    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'glm-4.7-flash',
        messages,
        temperature: options?.temperature ?? 0.3,
        max_tokens: options?.maxTokens ?? 4096,
        stream: false,
      }),
      signal: this.abortController.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Z.AI API ${res.status}: ${text}`);
    }

    const data = await res.json() as ZaiResponse;
    const msg = data.choices?.[0]?.message;
    const content = msg?.content || msg?.reasoning_content;

    if (!content) {
      throw new Error(`Unexpected Z.AI response: ${JSON.stringify(data).slice(0, 300)}`);
    }

    return content;
  }

  async generateCommitMessage(diff: string): Promise<string> {
    const truncatedDiff = diff.length > MAX_DIFF_CHARS
      ? diff.slice(0, MAX_DIFF_CHARS) + '\n\n... (diff truncated)'
      : diff;

    const content = await this.call([
      { role: 'system', content: COMMIT_PROMPT },
      { role: 'user', content: `Generate a commit message for this diff:\n\n${truncatedDiff}` },
    ]);

    const result = this.extractCommitFromReasoning(content);
    return result.trim().replace(/^["'`]+|["'`]+$/g, '');
  }

  private extractCommitFromReasoning(text: string): string {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const commitPattern = /^(feat|fix|refactor|chore|docs|style|test|perf|ci|build)(\(.+?\))?:\s*.+/;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (commitPattern.test(lines[i])) {
        return lines[i];
      }
    }
    return lines[lines.length - 1] || text;
  }
}
