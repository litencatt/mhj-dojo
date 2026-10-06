#!/usr/bin/env bash
# Opens (or updates) the pull request that publishes a site release to
# Lolipop Deploy Now: the release branch release/<tag>, cut from
# lolipop-deploy-now, merges the tag and replaces web/dist-site entirely with
# the tag's Release asset (mhj-dojo-site-<tag>.tar.gz, checked against its
# .sha256). .github/workflows/deploy-lolipop.yml runs this; run it by hand
# from a clone of the repository when that workflow fails:
#
#   scripts/deploy-lolipop.sh v2026.1006.1
#
# It works in a temporary git worktree and deletes its local release/<tag>
# branch when done, so the current checkout is left as it is. Needs git, gh
# (logged in), python3, and sha256sum or shasum. It pushes to the remote
# origin (DEPLOY_REMOTE to use another), and talks to the GitHub repository
# GITHUB_REPOSITORY (owner/name), or else gh's default for this clone: set
# both together when they aren't the same repository.
#
# .github/workflows on the release branch is set to the default branch's
# (main's) version, not the tag's. GitHub refused a GITHUB_TOKEN push of a
# release whose workflow files differed from main's ("refusing to allow a
# GitHub App to create or update workflow ... without `workflows`
# permission"; main had changed a workflow while the release was being
# built, issue #261), while earlier releases whose workflow files matched
# main's at push time went through, even though they changed workflows on
# lolipop-deploy-now. The rule isn't documented; it appears to compare the
# pushed branch with the default branch. Of the workflow files on
# lolipop-deploy-now only verify-live.yml runs (on its push), so it follows
# main's latest while the rest of the branch (web/ included) is the tag's.
set -euo pipefail

TAG=${1:?usage: scripts/deploy-lolipop.sh <tag>}
if ! [[ $TAG =~ ^v[0-9]{4}\.[0-9]{4}\.[0-9]+$ ]]; then
  echo "Not a release tag (vYYYY.MMDD.N): $TAG" >&2
  exit 1
fi
REMOTE=${DEPLOY_REMOTE:-origin}
RELEASE_BRANCH=lolipop-deploy-now
DEFAULT_BRANCH=main
SERVER_URL=${GITHUB_SERVER_URL:-https://github.com}
REPO=${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}

work=$(mktemp -d)
tree="$work/tree"
branch="release/$TAG"
cleanup() {
  git worktree remove --force "$tree" 2>/dev/null || true
  git branch -q -D "$branch" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

git fetch -q "$REMOTE" "+refs/tags/$TAG:refs/tags/$TAG" \
  "+refs/heads/$DEFAULT_BRANCH:refs/remotes/$REMOTE/$DEFAULT_BRANCH"
sha=$(git rev-parse "$TAG^{commit}")
short=$(git rev-parse --short "$sha")

# Download and verify the release artifact.
asset="mhj-dojo-site-$TAG.tar.gz"
gh release download "$TAG" --repo "$REPO" --dir "$work" --pattern "$asset" --pattern "$asset.sha256"
if command -v sha256sum >/dev/null; then
  (cd "$work" && sha256sum -c "$asset.sha256")
else
  (cd "$work" && shasum -a 256 -c "$asset.sha256")
fi
mkdir "$work/dist-site"
tar -C "$work/dist-site" -xzf "$work/$asset"

# The first release starts lolipop-deploy-now at the tag. (This push carries
# the tag's workflow files as they are, so it can be refused like issue
# #261's if main has changed a workflow since; it only ever happens once.)
if ! git ls-remote --exit-code --heads "$REMOTE" "$RELEASE_BRANCH" >/dev/null; then
  git push -q "$REMOTE" "$sha:refs/heads/$RELEASE_BRANCH"
fi
git fetch -q "$REMOTE" "+refs/heads/$RELEASE_BRANCH:refs/remotes/$REMOTE/$RELEASE_BRANCH"

git worktree add -q -B "$branch" "$tree" "$REMOTE/$RELEASE_BRANCH"
(
  cd "$tree"
  # Merge the tag, with .github/workflows taken from main (see above); a
  # conflict there is resolved the same way, any other conflict stops here.
  # A failed merge is checked below: conflicts by file, anything else by
  # whether the tag ended up merged.
  git merge -q --no-ff --no-commit "$sha" || true
  git rm -rqf --ignore-unmatch .github/workflows
  git checkout "$REMOTE/$DEFAULT_BRANCH" -- .github/workflows
  if [ -n "$(git diff --name-only --diff-filter=U)" ]; then
    echo "Merging $TAG into $RELEASE_BRANCH conflicts:" >&2
    git diff --name-only --diff-filter=U >&2
    exit 1
  fi
  if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
    git commit -q --no-edit -m "Merge $TAG ($short) for release"
  fi
  # A redeploy of an older tag (a rollback) is already merged: nothing new
  # to merge, but the tag must be in the branch's history either way.
  if ! git merge-base --is-ancestor "$sha" HEAD; then
    echo "Merging $TAG into $RELEASE_BRANCH failed (see the merge output above)" >&2
    exit 1
  fi

  # Replace web/dist-site entirely with the release asset's contents (not
  # a merge of the two trees), so redeploying an older tag — a rollback —
  # leaves the branch with exactly that release's files, not a mix with
  # whatever came after it.
  rm -rf web/dist-site
  mv "$work/dist-site" web/dist-site
  git add -A .github/workflows
  git add -f web/dist-site # gitignored on main
  git commit -q -m "Deploy the site release $TAG" -m "$SERVER_URL/$REPO/releases/tag/$TAG"
)
# Pushed from the main checkout, whose credentials (actions/checkout's) may
# not apply inside the worktree.
git push -q --force "$REMOTE" "$branch"

# What main brings since the last release: its merged pull requests (a merge
# commit's body is the pull request's title) and any commit pushed to main
# directly.
changes=$(git log --first-parent --format='%h%x1f%s%x1f%b%x1e' "$REMOTE/$RELEASE_BRANCH..$sha" | python3 -c '
import re, sys
for rec in sys.stdin.read().split("\x1e"):
    parts = rec.strip("\n").split("\x1f")
    if len(parts) < 2:
        continue
    sha, subject, body = parts[0], parts[1], parts[2] if len(parts) > 2 else ""
    m = re.match(r"Merge pull request (#\d+)", subject)
    title = f"{body.strip().splitlines()[0]} ({m.group(1)})" if m and body.strip() else subject
    print(f"- {title} {sha}")
')
{
  echo "リリース [$TAG]($SERVER_URL/$REPO/releases/tag/$TAG)（\`$short\`）を公開用ブランチ \`$RELEASE_BRANCH\` に取り込み、リリースの公開サイト（\`web/dist-site\`。ヘッダーに $TAG と表示）を含めます。マージすると、デプロイナウが公開します。"
  echo
  echo "**「Create a merge commit」でマージしてください**（squash しない）。次回のリリースで main をきれいに取り込むためです。"
  echo
  echo "## 前回のリリース以降の変更"
  echo "$changes"
  echo
  echo "## 確認"
  echo "- 公開サイト版の E2E: リリースのビルド時に実行済み（[GitHub Release]($SERVER_URL/$REPO/releases/tag/$TAG) に添付のビルド）"
  echo "- main の CI: $SERVER_URL/$REPO/commit/$sha"
} > "$work/body.md"
# Only an open pull request is reused: release/<tag> of a rollback to an
# earlier release already has that release's merged one.
url=$(gh pr list --repo "$REPO" --head "$branch" --state open --json url -q '.[0].url')
if [ -n "$url" ]; then
  gh pr edit "$branch" --repo "$REPO" --body-file "$work/body.md" >/dev/null
else
  url=$(gh pr create --repo "$REPO" --base "$RELEASE_BRANCH" --head "$branch" \
    --title "Release $TAG to Deploy Now" --body-file "$work/body.md")
fi
echo "Release pull request: $url"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "Release pull request: $url" >> "$GITHUB_STEP_SUMMARY"
fi
