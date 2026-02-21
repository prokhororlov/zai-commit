#!/bin/bash
# Benchmark: GLM-4.7-flash vs Claude Haiku for commit message generation
# Usage: bash benchmark.sh [diff_file] [rounds]

set -euo pipefail

# Allow nested claude invocations
unset CLAUDECODE 2>/dev/null || true

DIFF_FILE="${1:-/tmp/test_diff.txt}"
ROUNDS="${2:-3}"
RESULTS_DIR="/tmp/commit-bench"
rm -rf "$RESULTS_DIR"
mkdir -p "$RESULTS_DIR"

# --- Prompt (same for both) ---
SYSTEM_PROMPT='You are a git commit message generator. Rules:
1. Use conventional commits format: type(scope): description
2. Types: feat, fix, refactor, chore, docs, style, test, perf, ci, build
3. Keep the subject line under 72 characters
4. Be concise — describe WHAT changed, not WHY
5. Use imperative mood: "add feature" not "added feature"
6. Output ONLY the commit message, nothing else — no explanation, no reasoning
7. If changes span multiple areas, use the most impactful type
8. For scope, use the main module/component affected'

# Save user message to a file to avoid arg-too-long issues
USER_MSG_FILE="$RESULTS_DIR/user_msg.txt"
{
  echo "Generate a commit message for this diff:"
  echo ""
  cat "$DIFF_FILE"
} > "$USER_MSG_FILE"

# Convert bash /tmp path to Windows path for Python
WIN_RESULTS_DIR=$(cygpath -w "$RESULTS_DIR" 2>/dev/null || echo "$RESULTS_DIR")
WIN_USER_MSG_FILE=$(cygpath -w "$USER_MSG_FILE" 2>/dev/null || echo "$USER_MSG_FILE")

# --- Z.AI API key ---
ZAI_KEY="${ZAI_API_KEY:-}"
if [ -z "$ZAI_KEY" ]; then
  echo "Set ZAI_API_KEY env variable or enter Z.AI API key:"
  read -r ZAI_KEY
fi

# ============================================================
# GLM generation function
# ============================================================
run_glm() {
  local round=$1
  local out="$RESULTS_DIR/glm_${round}"
  local win_out
  win_out=$(cygpath -w "$out" 2>/dev/null || echo "$out")

  # Build JSON payload via Python (handles large diffs safely)
  local payload_file="$RESULTS_DIR/glm_payload_${round}.json"
  local win_payload
  win_payload=$(cygpath -w "$payload_file" 2>/dev/null || echo "$payload_file")

  python3 -c "
import json
with open(r'$WIN_USER_MSG_FILE', 'r', encoding='utf-8') as f:
    user_msg = f.read()
sys_prompt = '''$SYSTEM_PROMPT'''
payload = {
    'model': 'glm-4.7-flash',
    'messages': [
        {'role': 'system', 'content': sys_prompt},
        {'role': 'user', 'content': user_msg}
    ],
    'temperature': 0.3,
    'max_tokens': 4096,
    'stream': False
}
with open(r'$win_payload', 'w', encoding='utf-8') as f:
    json.dump(payload, f, ensure_ascii=False)
"

  local start end elapsed
  start=$(date +%s%3N)

  local response
  response=$(curl -s -w "\n%{http_code}" \
    -X POST "https://api.z.ai/api/paas/v4/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ZAI_KEY" \
    -d @"$payload_file")

  end=$(date +%s%3N)
  elapsed=$((end - start))

  local http_code body msg
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "200" ]; then
    msg=$(echo "$body" | jq -r '.choices[0].message.content // .choices[0].message.reasoning_content // "ERROR: no content"')
  else
    msg="HTTP_ERROR: $http_code | $(echo "$body" | head -c 200)"
  fi

  echo "$msg" > "${out}.txt"
  echo "$elapsed" > "${out}.ms"
  echo "  GLM    #$round: ${elapsed}ms | $msg"
}

# ============================================================
# Claude Haiku generation function
# ============================================================
run_claude() {
  local round=$1
  local out="$RESULTS_DIR/claude_${round}"

  local start end elapsed
  start=$(date +%s%3N)

  local msg
  msg=$(cat "$USER_MSG_FILE" | claude -p \
    --model haiku \
    --system-prompt "$SYSTEM_PROMPT" \
    --no-session-persistence \
    --tools "" \
    2>/dev/null) || msg="CLAUDE_ERROR"

  end=$(date +%s%3N)
  elapsed=$((end - start))

  # Take only the last conventional-commit-looking line
  local cleaned
  cleaned=$(echo "$msg" | grep -E '^(feat|fix|refactor|chore|docs|style|test|perf|ci|build)' | tail -1)
  if [ -z "$cleaned" ]; then
    cleaned=$(echo "$msg" | tail -1)
  fi

  echo "$cleaned" > "${out}.txt"
  echo "$elapsed" > "${out}.ms"
  echo "  Claude #$round: ${elapsed}ms | $cleaned"
}

# ============================================================
# Main
# ============================================================
echo "======================================"
echo " Commit Message Generation Benchmark"
echo "======================================"
echo "Diff size: $(wc -c < "$DIFF_FILE") bytes"
echo "Rounds:    $ROUNDS"
echo ""

# Run all rounds in parallel
echo "--- Starting $ROUNDS parallel rounds ($(( ROUNDS * 2 )) tasks) ---"
echo ""

pids=()
for i in $(seq 1 "$ROUNDS"); do
  run_glm "$i" &
  pids+=($!)
  run_claude "$i" &
  pids+=($!)
done

# Wait for all
for pid in "${pids[@]}"; do
  wait "$pid" 2>/dev/null || true
done

echo ""
echo "======================================"
echo " Results Summary"
echo "======================================"

# Collect times
glm_times=()
claude_times=()
for i in $(seq 1 "$ROUNDS"); do
  glm_times+=("$(cat "$RESULTS_DIR/glm_${i}.ms" 2>/dev/null || echo 0)")
  claude_times+=("$(cat "$RESULTS_DIR/claude_${i}.ms" 2>/dev/null || echo 0)")
done

# Calculate averages
glm_sum=0; claude_sum=0
for t in "${glm_times[@]}"; do glm_sum=$((glm_sum + t)); done
for t in "${claude_times[@]}"; do claude_sum=$((claude_sum + t)); done
glm_avg=$((glm_sum / ROUNDS))
claude_avg=$((claude_sum / ROUNDS))

echo ""
printf "%-22s %s\n" "GLM-4.7-flash times:" "${glm_times[*]} ms"
printf "%-22s %s\n" "Claude Haiku times:" "${claude_times[*]} ms"
echo ""
printf "%-22s %sms\n" "GLM avg:" "$glm_avg"
printf "%-22s %sms\n" "Claude avg:" "$claude_avg"
echo ""

if [ "$glm_avg" -gt 0 ] && [ "$claude_avg" -gt 0 ]; then
  if [ "$glm_avg" -lt "$claude_avg" ]; then
    diff_pct=$(( (claude_avg - glm_avg) * 100 / glm_avg ))
    echo ">>> GLM faster by ~${diff_pct}%"
  elif [ "$claude_avg" -lt "$glm_avg" ]; then
    diff_pct=$(( (glm_avg - claude_avg) * 100 / claude_avg ))
    echo ">>> Claude Haiku faster by ~${diff_pct}%"
  else
    echo ">>> Same speed"
  fi
fi

echo ""
echo "--- Generated messages ---"
for i in $(seq 1 "$ROUNDS"); do
  echo ""
  echo "Round $i:"
  printf "  GLM:    %s\n" "$(cat "$RESULTS_DIR/glm_${i}.txt" 2>/dev/null || echo 'N/A')"
  printf "  Claude: %s\n" "$(cat "$RESULTS_DIR/claude_${i}.txt" 2>/dev/null || echo 'N/A')"
done
