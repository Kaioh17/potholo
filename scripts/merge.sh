#!/usr/bin/env bash
# Land the current feature branch on main with a linear history: rebase it onto
# the latest main, then fast-forward main to it. No merge commit is created.
#
#   scripts/merge.sh          asks before updating main
#   scripts/merge.sh --yes    does not ask
#
# The branch is pushed first so the remote branch matches what lands on main.
# It is not deleted afterwards. If the rebase hits a conflict, resolve it, run
# `git rebase --continue`, then run this script again.
set -euo pipefail

BASE="${BASE:-main}"
REMOTE="${REMOTE:-origin}"

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" == "$BASE" || "$branch" == "HEAD" ]]; then
  echo "Refusing to run on '$branch'. Switch to the feature branch to merge." >&2
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

echo
git log --oneline "$REMOTE/$BASE..$branch"
echo
if [[ "${1:-}" != "--yes" ]]; then
  read -r -p "Fast-forward $BASE to $branch and push it to $REMOTE? [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" ]] || { echo "Stopped. $branch is rebased but $BASE is unchanged."; exit 1; }
fi

git push --force-with-lease --set-upstream "$REMOTE" "$branch"

git switch "$BASE"
git pull --ff-only "$REMOTE" "$BASE"
git merge --ff-only "$branch"
git push "$REMOTE" "$BASE"

echo "Done. $BASE now includes $branch. Delete the branch with: git branch -d $branch"
