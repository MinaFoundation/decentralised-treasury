#!/usr/bin/env bash
#
# Builds and pushes the multi-architecture images another operator can run.
#
#   ./devops/scripts/publish-images.sh                  # tag from the current commit
#   ./devops/scripts/publish-images.sh v1.4.0           # explicit tag
#   NAMESPACE=myorg ./devops/scripts/publish-images.sh  # somewhere other than Docker Hub minafoundation
#
# Two images are built, for linux/amd64 and linux/arm64:
#
#   dt-web            the slim Next.js standalone UI (Dockerfile target `web`)
#   dt-api, dt-api-migrate, dt-indexer, dt-indexer-api,
#   dt-processor, dt-processor-api, dt-voting-ledger-scheduler,
#   dt-proving-worker, dt-proving-scheduler
#                     one identical services image (Dockerfile target `base`),
#                     pushed under each name because compose distinguishes the
#                     services only by the command it runs
#
# Neither image contains deployment-specific configuration; everything is
# supplied through environment variables at run time. See devops/PUBLISHING.md.
#
# Environment overrides:
#   NAMESPACE   registry namespace                  (default: minafoundation)
#   PLATFORMS   architectures to build              (default: linux/amd64,linux/arm64)
#   PUSH        set to false to build without pushing
#   MOVE_LATEST set to false to leave :latest alone

set -euo pipefail

NAMESPACE="${NAMESPACE:-minafoundation}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
PUSH="${PUSH:-true}"
MOVE_LATEST="${MOVE_LATEST:-true}"
BUILDER="${BUILDER:-treasury-publisher}"

WEB_REPOS=("dt-web")
SERVICES_REPOS=(
  "dt-api"
  "dt-api-migrate"
  "dt-indexer"
  "dt-indexer-api"
  "dt-processor"
  "dt-processor-api"
  # Same image again: these three differ only in the command the orchestrator
  # runs - the two scheduler entrypoints under devops/docker and the `cli
  # worker start` invocation. Published under their own names so a Helm chart,
  # which addresses one image per workload, can reference them.
  "dt-voting-ledger-scheduler"
  "dt-proving-worker"
  "dt-proving-scheduler"
)

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to publish: the working tree has uncommitted changes, so the" >&2
  echo "image tag would not identify the code inside the image. Commit first," >&2
  echo "or re-run with ALLOW_DIRTY=true to override." >&2
  [ "${ALLOW_DIRTY:-false}" = "true" ] || exit 1
fi

BUILD_SHA="${BUILD_SHA:-$(git rev-parse HEAD)}"
TAG="${1:-${TAG:-$(git rev-parse --short HEAD)}}"

# A docker-container builder is required: the default 'docker' driver cannot
# emit a multi-architecture manifest.
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  echo "Creating buildx builder '$BUILDER'..."
  docker buildx create --name "$BUILDER" --driver docker-container --bootstrap >/dev/null
fi

# One buildx invocation per target, carrying every destination repo as a tag, so
# the (slow, partly emulated) build runs once rather than once per repo.
build_image() {
  local target="$1"
  shift
  local repos=("$@")
  local args=()
  local repo

  for repo in "${repos[@]}"; do
    args+=(--tag "$NAMESPACE/$repo:$TAG")
    if [ "$MOVE_LATEST" = "true" ]; then
      args+=(--tag "$NAMESPACE/$repo:latest")
    fi
  done

  if [ "$PUSH" = "true" ]; then
    args+=(--push)
    # The first publish logs "buildcache: not found" for the import; that is
    # only a cold cache and does not fail the build. ignore-error keeps a
    # failed cache *export* from failing an otherwise successful publish.
    args+=(--cache-from "type=registry,ref=$NAMESPACE/${repos[0]}:buildcache")
    args+=(--cache-to "type=registry,ref=$NAMESPACE/${repos[0]}:buildcache,mode=max,ignore-error=true")
  fi

  echo
  echo "==> target '$target' -> ${repos[*]}  ($PLATFORMS, tag $TAG)"
  docker buildx build \
    --builder "$BUILDER" \
    --platform "$PLATFORMS" \
    --target "$target" \
    --file devops/docker/Dockerfile \
    --build-arg "BUILD_SHA=$BUILD_SHA" \
    "${args[@]}" \
    .
}

build_image web "${WEB_REPOS[@]}"
build_image base "${SERVICES_REPOS[@]}"

echo
if [ "$PUSH" = "true" ]; then
  echo "Published tag '$TAG' from commit $BUILD_SHA."
  echo "Verify the published architectures with:"
  echo "  docker buildx imagetools inspect $NAMESPACE/dt-web:$TAG"
else
  echo "Built '$TAG' for $PLATFORMS without publishing."
fi
