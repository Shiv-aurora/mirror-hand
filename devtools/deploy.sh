#!/bin/sh
# Build the site and publish dist/ to the gh-pages branch (GitHub Pages).
# Usage: NODE=/path/to/node22 sh devtools/deploy.sh
set -e
NODE_BIN="${NODE:-node}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
"$NODE_BIN" node_modules/typescript/bin/tsc --noEmit
NODE_ENV=production "$NODE_BIN" node_modules/vite/bin/vite.js build
touch dist/.nojekyll
REMOTE="$(git remote get-url origin)"
NAME="$(git config user.name)"
EMAIL="$(git config user.email)"
cd dist
rm -rf .git
git init -q -b gh-pages
git config user.name "$NAME"
git config user.email "$EMAIL"
git add -A
git commit -q -m "Deploy $(cd "$ROOT" && git rev-parse --short HEAD)"
git push -q -f "$REMOTE" gh-pages
rm -rf .git
echo "Published."
