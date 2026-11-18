#!/usr/bin/env bash
# Builds today's fork as a straight line: Silo's main, then the commits of each
# branch in .github/fork-branches.txt replayed on top, in order. No merge
# commits, so main is always Silo plus exactly the fork's own commits.
#
# The workflow then force-pushes main to this build, but only while main is
# still the previous build (anything pushed to main by hand stops the run).
#
# Exit codes: 0 built (or nothing changed), 2 conflict, 3 main changed by hand,
# 1 anything else.
#
# Env: DRY_RUN=1 skips every push. UPSTREAM_URL overrides Silo's repo.
# UPSTREAM_REF pins upstream to a commit instead of fetching (for testing).
# Outputs go to $GITHUB_OUTPUT when set.
set -euo pipefail

UPSTREAM_URL=${UPSTREAM_URL:-https://github.com/Silo-Server/silo-server.git}
LIST=${FORK_BRANCHES_FILE:-.github/fork-branches.txt}
DRY_RUN=${DRY_RUN:-0}
OUT=${GITHUB_OUTPUT:-/dev/null}

out() { echo "$1=$2" >>"$OUT"; }
push() {
  if [[ $DRY_RUN == 1 ]]; then echo "dry run: skip git push $*"; else git push "$@"; fi
}

mapfile -t BRANCHES < <(sed -e 's/#.*//' -e 's/[[:space:]]//g' "$LIST" | grep -v '^$')
[[ ${#BRANCHES[@]} -gt 0 ]] || { echo "no branches in $LIST" >&2; exit 1; }

git fetch --quiet --prune origin '+refs/heads/*:refs/remotes/origin/*'
for b in "${BRANCHES[@]}"; do
  git rev-parse --verify --quiet "origin/$b^{commit}" >/dev/null \
    || { echo "listed branch origin/$b does not exist" >&2; exit 1; }
done

# 1. Mirror Silo's main onto the upstream branch, fast-forward only.
if [[ -n ${UPSTREAM_REF:-} ]]; then
  UP=$(git rev-parse "$UPSTREAM_REF^{commit}")
else
  git fetch --quiet "$UPSTREAM_URL" main
  UP=$(git rev-parse FETCH_HEAD)
fi
if git rev-parse --verify --quiet origin/upstream >/dev/null; then
  git merge-base --is-ancestor origin/upstream "$UP" \
    || { echo "origin/upstream is not an ancestor of Silo main $UP; refusing to rewrite it" >&2; exit 1; }
fi
[[ $(git rev-parse -q --verify origin/upstream || true) == "$UP" ]] || push origin "$UP:refs/heads/upstream"
out upstream "$UP"

# 2. main is replaced below, so it must still be the last build. A commit
# pushed to main by hand would be lost: stop and name it instead.
MAIN=$(git rev-parse origin/main)
out main_before "$MAIN"
LAST=$(git for-each-ref --sort=-committerdate --count=1 --format='%(refname)' refs/remotes/origin/build/)
if [[ -n $LAST && $(git rev-parse "$LAST") != "$MAIN" ]]; then
  {
    echo "main is not the last build (${LAST#refs/remotes/origin/}). Commits on main that it lacks:"
    git log --format='%h %s' "$LAST..$MAIN"
    echo "Move them onto a fork branch, or reset main to the last build, then rerun."
  } >&2
  out failure diverged
  exit 3
fi

# 3. Pick a fresh build/<date> name (14, 14b, 14c, ...).
DAY=$(date -u +%Y-%m-%d)
BUILD="build/$DAY"
for s in b c d e f g h i j; do
  git rev-parse --verify --quiet "origin/$BUILD" >/dev/null || break
  BUILD="build/$DAY$s"
done
out branch "$BUILD"

# 4. Replay each branch's own commits on top of Silo. A commit whose change
# Silo already has comes out empty and is dropped.
fail_conflict() {
  local b=$1 files=$2
  git cherry-pick --abort 2>/dev/null || true
  {
    echo "conflict replaying $b onto $BUILD (upstream $UP):"
    echo "$files"
  } >&2
  out failure conflict
  out conflict_branch "$b"
  { echo "conflict_files<<EOF"; echo "$files"; echo "EOF"; } >>"$OUT"
  exit 2
}
git switch --quiet --force-create "$BUILD" "$UP"
for b in "${BRANCHES[@]}"; do
  base=$(git merge-base "$UP" "origin/$b")
  if [[ -n $(git rev-list --merges "$base..origin/$b") ]]; then
    echo "$b has merge commits; rebase it onto upstream so it holds only its own commits" >&2
    out failure conflict
    out conflict_branch "$b"
    exit 2
  fi
  for c in $(git rev-list --reverse "$base..origin/$b"); do
    if ! git cherry-pick --allow-empty "$c" >/dev/null 2>&1; then
      FILES=$(git diff --name-only --diff-filter=U)
      [[ -n $FILES ]] && fail_conflict "$b" "$FILES"
      # Nothing to commit: Silo already has this change.
      git cherry-pick --skip >/dev/null 2>&1 || fail_conflict "$b" "(cherry-pick of $c failed)"
    fi
  done
done

SHA=$(git rev-parse HEAD)
out sha "$SHA"
echo "$BUILD: $(git rev-list --count "$UP..$SHA") fork commits on Silo $UP"
if [[ $(git rev-parse "HEAD^{tree}") == $(git rev-parse "$MAIN^{tree}") ]] \
  && git merge-base --is-ancestor "$UP" "$MAIN" \
  && [[ -z $(git rev-list --merges "$UP..$MAIN") ]]; then
  echo "build matches main; nothing to ship"
  out changed false
  exit 0
fi
out changed true
push origin "$SHA:refs/heads/$BUILD"
echo "built $BUILD at $SHA"
