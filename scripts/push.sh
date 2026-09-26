#!/usr/bin/env bash
# Publish the current feature branch, rebased onto the latest main.
#
#   scripts/push.sh
#
# Rebasing rewrites the branch's commits, so the push uses --force-with-lease:
# it overwrites the remote branch only if nobody else has pushed to it since you
# last fetched. If the rebase hits a conflict, resolve it, run
# `git rebase --continue`, then run this script again.
set -euo pipefail

BASE="${BASE:-main}"
REMOTE="${REMOTE:-origin}"

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" == "$BASE" || "$branch" == "HEAD" ]]; then
  echo "Refusing to run on '$branch'. Switch to a feature branch first." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Uncommitted changes. Commit or stash them first." >&2
  exit 1
fi

echo "Fetching $REMOTE..."
git fetch "$REMOTE"

echo "Rebasing $branch onto $REMOTE/$BASE..."
git rebase "$REMOTE/$BASE"

echo "Pushing $branch..."
git push --force-with-lease --set-upstream "$REMOTE" "$branch"

echo "Done. $branch is up to date with $BASE and pushed."
