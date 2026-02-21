import * as vscode from 'vscode';

interface GitRepository {
  diff(cached?: boolean): Promise<string>;
  state: {
    indexChanges: unknown[];
    workingTreeChanges: unknown[];
  };
  inputBox: { value: string };
}

interface GitAPI {
  repositories: GitRepository[];
}

async function getGitAPI(): Promise<GitAPI> {
  const ext = vscode.extensions.getExtension<{ getAPI(version: number): GitAPI }>('vscode.git');
  if (!ext) {
    throw new Error('Git extension not found');
  }
  if (!ext.isActive) {
    await ext.activate();
  }
  return ext.exports.getAPI(1);
}

function getRepo(api: GitAPI): GitRepository {
  if (api.repositories.length === 0) {
    throw new Error('No git repositories found');
  }
  return api.repositories[0];
}

export async function getDiff(): Promise<string | null> {
  const api = await getGitAPI();
  const repo = getRepo(api);

  const hasStaged = repo.state.indexChanges.length > 0;
  const hasUnstaged = repo.state.workingTreeChanges.length > 0;

  if (!hasStaged && !hasUnstaged) {
    return null;
  }

  // Staged changes take priority; fall back to unstaged
  if (hasStaged) {
    const diff = await repo.diff(true);
    if (diff) {
      return diff;
    }
  }

  const diff = await repo.diff(false);
  return diff || null;
}

export async function setCommitMessage(message: string): Promise<void> {
  const api = await getGitAPI();
  const repo = getRepo(api);
  repo.inputBox.value = message;
}
