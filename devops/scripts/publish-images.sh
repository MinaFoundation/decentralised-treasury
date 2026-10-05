#!/usr/bin/env bash
#
# Builds and pushes the multi-architecture images another operator can run.
#
#   ./devops/scripts/publish-images.sh                  # tag from the current commit
#   ./devops/scripts/publish-images.sh v1.4.0           # explicit tag
#   NAMESPACE=myorg ./devops/scripts/publish-images.sh  # somewhere other than Docker Hub minafoundation
#
# Four image targets are built, for linux/arm64 and linux/amd64:
#
#   dt-web            the slim Next.js standalone UI (Dockerfile target `web`)
#   dt-backoffice     the offline-first signing UI (Dockerfile target `backoffice`)
#   dt-docs           the documentation site behind nginx, at /docs/
#                     (Dockerfile target `docs`)
#   dt-api, dt-api-migrate, dt-indexer, dt-indexer-api,
#   dt-processor, dt-processor-api, dt-voting-ledger-scheduler,
#   dt-proving-worker, dt-proving-scheduler
#                     one identical services image (Dockerfile target `base`),
#                     pushed under each name because compose distinguishes the
#                     services only by the command it runs
#
# By default the script builds one architecture at a time, in PLATFORMS order:
# every target for linux/arm64 first, then every target for linux/amd64. Each
# build pushes a per-architecture tag (<tag>-arm64, <tag>-amd64). When all the
# builds succeed, the script joins those tags into the multi-architecture
# <tag> (and :latest). A failed build therefore never moves <tag> or :latest.
# One build at a time needs approximately half the memory of a parallel build.
#
# New builds exclude every .env* file through .dockerignore. Deployment
# configuration is supplied at runtime. Verify images before publication;
# older images need separate cleanup. See devops/PUBLISHING.md.
#
# Environment overrides:
#   NAMESPACE        registry namespace                (default: minafoundation)
#   PLATFORMS        architectures to build, in order  (default: linux/arm64,linux/amd64)
#   PUSH             set to false to build without pushing
#   MOVE_LATEST      set to false to leave :latest alone
#   SPLIT_PLATFORMS  set to false to build all architectures in one parallel
#                    buildx call (faster, needs more memory)

set -euo pipefail

NAMESPACE="${NAMESPACE:-minafoundation}"
PLATFORMS="${PLATFORMS:-linux/arm64,linux/amd64}"
PUSH="${PUSH:-true}"
MOVE_LATEST="${MOVE_LATEST:-true}"
SPLIT_PLATFORMS="${SPLIT_PLATFORMS:-true}"
BUILDER="${BUILDER:-treasury-publisher}"

# The arrays are read through load_target indirect expansion.
# shellcheck disable=SC2034
{
  WEB_REPOS=("dt-web")
  BACKOFFICE_REPOS=("dt-backoffice")
  DOCS_REPOS=("dt-docs")
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
}

# target:repo-array-name pairs, in build order.
TARGETS=(
  "web:WEB_REPOS"
  "backoffice:BACKOFFICE_REPOS"
  "docs:DOCS_REPOS"
  "base:SERVICES_REPOS"
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

IFS=',' read -r -a PLATFORM_LIST <<<"$PLATFORMS"

# A docker-container builder is required: the default 'docker' driver cannot
# emit a multi-architecture manifest.
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  echo "Creating buildx builder '$BUILDER'..."
  docker buildx create --name "$BUILDER" --driver docker-container --bootstrap >/dev/null
fi

# linux/arm64 -> arm64, linux/arm/v7 -> arm-v7
arch_suffix() {
  local arch="${1#*/}"
  echo "${arch//\//-}"
}

# One buildx invocation per target and platform set, carrying every
# destination repo as a tag, so the (slow, partly emulated) build runs once
# rather than once per repo.
#
#   build_image <target> <platforms> <tag-suffix> <repo>...
#
# An empty suffix pushes <tag> (and :latest) directly. A suffix such as
# "-arm64" pushes only <tag>-arm64, for join_manifests to combine later.
build_image() {
  local target="$1" platforms="$2" suffix="$3"
  shift 3
  local repos=("$@")
  local args=()
  local repo

  for repo in "${repos[@]}"; do
    args+=(--tag "$NAMESPACE/$repo:$TAG$suffix")
    if [ -z "$suffix" ] && [ "$MOVE_LATEST" = "true" ]; then
      args+=(--tag "$NAMESPACE/$repo:latest")
    fi
  done

  if [ "$PUSH" = "true" ]; then
    args+=(--push)
    # The first publish logs "buildcache: not found" for the import; that is
    # only a cold cache and does not fail the build. ignore-error keeps a
    # failed cache *export* from failing an otherwise successful publish.
    # Each platform set has its own cache ref, so that one architecture's
    # export does not replace the cache of the other.
    local cache_ref="$NAMESPACE/${repos[0]}:buildcache$suffix"
    args+=(--cache-from "type=registry,ref=$cache_ref")
    args+=(--cache-to "type=registry,ref=$cache_ref,mode=max,ignore-error=true")
  fi

  echo
  echo "==> target '$target' -> ${repos[*]}  ($platforms, tag $TAG$suffix)"
  docker buildx build \
    --builder "$BUILDER" \
    --platform "$platforms" \
    --target "$target" \
    --file devops/docker/Dockerfile \
    --build-arg "BUILD_SHA=$BUILD_SHA" \
    "${args[@]}" \
    .
}

# Joins the per-architecture tags of each repo into one multi-architecture
# <tag> (and :latest). The registry copies only manifests; nothing is rebuilt.
join_manifests() {
  local repos=("$@")
  local repo platform sources tags

  for repo in "${repos[@]}"; do
    sources=()
    for platform in "${PLATFORM_LIST[@]}"; do
      sources+=("$NAMESPACE/$repo:$TAG-$(arch_suffix "$platform")")
    done
    tags=(--tag "$NAMESPACE/$repo:$TAG")
    if [ "$MOVE_LATEST" = "true" ]; then
      tags+=(--tag "$NAMESPACE/$repo:latest")
    fi

    echo "==> manifest $NAMESPACE/$repo:$TAG <- ${sources[*]}"
    docker buildx imagetools create --builder "$BUILDER" "${tags[@]}" "${sources[@]}"
  done
}

# Sets $target and the $repos array from a "target:REPO_ARRAY" entry.
# (Indirect expansion rather than mapfile, so macOS's bash 3.2 also works.)
load_target() {
  local repos_ref="${1#*:}[@]"
  target="${1%%:*}"
  repos=("${!repos_ref}")
}

if [ "$SPLIT_PLATFORMS" != "true" ]; then
  for entry in "${TARGETS[@]}"; do
    load_target "$entry"
    build_image "$target" "$PLATFORMS" "" "${repos[@]}"
  done
else
  for platform in "${PLATFORM_LIST[@]}"; do
    for entry in "${TARGETS[@]}"; do
      load_target "$entry"
      build_image "$target" "$platform" "-$(arch_suffix "$platform")" "${repos[@]}"
    done
  done

  if [ "$PUSH" = "true" ]; then
    echo
    for entry in "${TARGETS[@]}"; do
      load_target "$entry"
      join_manifests "${repos[@]}"
    done
  fi
fi

echo
if [ "$PUSH" = "true" ]; then
  echo "Published tag '$TAG' from commit $BUILD_SHA."
  echo "Verify the published architectures with:"
  echo "  docker buildx imagetools inspect $NAMESPACE/dt-web:$TAG"
  echo "  docker buildx imagetools inspect $NAMESPACE/dt-backoffice:$TAG"
else
  echo "Built '$TAG' for $PLATFORMS without publishing."
fi
