#!/usr/bin/env bash
# Builds today's fork: Silo's main, then each branch in .github/fork-branches.txt
# merged on top, then main's history recorded with -s ours so main can
# fast-forward to the result.
#
# Exit codes: 0 built (or nothing changed), 2 merge conflict, 3 main has
# commits no fork branch carries, 1 anything else.
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

git fetch --quiet origin '+refs/heads/*:refs/remotes/origin/*'
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

# 2. -s ours below discards anything that lives only on main. Stop if any
# commit reached main after the last build without being on a fork branch.
# (Older history is already in a build; rebased fork branches leave stale
# copies behind, which is fine.)
EXCL=("$UP")
LAST=$(git log -1 --format=%H --grep="^merge: record main's history in build/" origin/main)
[[ -n $LAST ]] && EXCL+=("$LAST")
for b in "${BRANCHES[@]}"; do EXCL+=("origin/$b"); done
ORPHANS=$(git log --no-merges --format='%h %s' origin/main --not "${EXCL[@]}")
if [[ -n $ORPHANS ]]; then
  {
    echo "main has commits that neither Silo nor a listed fork branch carries."
    echo "Move them onto a fork branch (or list the branch) before the next build:"
    echo "$ORPHANS"
  } >&2
  out failure orphans
  exit 3
fi

# 3. Pick a fresh build/<date> name, as the hand-made builds did (14, 14b, 14c).
DAY=$(date -u +%Y-%m-%d)
BUILD="build/$DAY"
for s in b c d e f g h i j; do
  git rev-parse --verify --quiet "origin/$BUILD" >/dev/null || break
  BUILD="build/$DAY$s"
done
out branch "$BUILD"

# 4. Merge each fork branch on top of Silo.
git switch --quiet --force-create "$BUILD" "$UP"
for b in "${BRANCHES[@]}"; do
  if ! git merge --quiet --no-ff --no-edit -m "merge: $b into $BUILD" "origin/$b"; then
    FILES=$(git diff --name-only --diff-filter=U)
    git merge --abort 2>/dev/null || true
    if [[ -z $FILES ]]; then
      echo "merging $b failed without a conflict (see above)" >&2
      out failure merge
      exit 1
    fi
    {
      echo "conflict merging $b into $BUILD (upstream $UP):"
      echo "$FILES"
    } >&2
    out failure conflict
    out conflict_branch "$b"
    { echo "conflict_files<<EOF"; echo "$FILES"; echo "EOF"; } >>"$OUT"
    exit 2
  fi
done

# 5. Record main's history so main fast-forwards to this build.
git merge --quiet -s ours --no-edit -m "merge: record main's history in $BUILD" origin/main

SHA=$(git rev-parse HEAD)
out sha "$SHA"
if [[ $(git rev-parse "HEAD^{tree}") == $(git rev-parse "origin/main^{tree}") ]]; then
  echo "build matches main; nothing to ship"
  out changed false
  exit 0
fi
out changed true
push origin "$SHA:refs/heads/$BUILD"
echo "built $BUILD at $SHA on Silo $UP"
