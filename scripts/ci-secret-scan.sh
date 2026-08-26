#!/bin/sh
# CI mirror of .githooks/pre-commit (P0-B Stage 3) — KEEP PATTERNS IN SYNC with that hook.
# Scans lines ADDED in the range BASE..HEAD. Never prints a matched value.
# Catches what the local hook can miss: --no-verify commits and clones that
# never ran `git config core.hooksPath .githooks`.
# Args: $1 = base sha (empty or all-zeros on branch creation), $2 = head sha.

BASE="$1"; HEAD="$2"
ZEROS=0000000000000000000000000000000000000000

if [ -n "$BASE" ] && [ "$BASE" != "$ZEROS" ] && git cat-file -e "$BASE" 2>/dev/null; then
  RANGE="$BASE..$HEAD"
  added=$(git log -p --no-color --unified=0 --format= "$RANGE" | grep -E '^\+' | grep -vE '^\+\+\+' || true)
else
  # New branch / unknown base: best-effort scan of the head commit only.
  RANGE="$HEAD (single commit)"
  added=$(git show --no-color --unified=0 --format= "$HEAD" | grep -E '^\+' | grep -vE '^\+\+\+' || true)
fi

patterns='(Bearer[[:space:]]+[0-9a-f]{40,})'
patterns="$patterns|(x-internal-[a-z-]*key[\"' :=]+[0-9a-f]{16,})"
patterns="$patterns|(whsec_[A-Za-z0-9]{16,})"
patterns="$patterns|(sk-[A-Za-z0-9]{20,})|(sk_live_[A-Za-z0-9]{16,})|(pk_live_[A-Za-z0-9]{16,})"
patterns="$patterns|(AKIA[0-9A-Z]{16})"
patterns="$patterns|(-----BEGIN[[:space:]][A-Z ]*PRIVATE KEY-----)"

if printf '%s\n' "$added" | grep -qEi "$patterns"; then
  echo "ci-secret-scan: FAILED - an added line in $RANGE matches a credential pattern." 1>&2
  echo "If the value was real: rotate it first, then rewrite history so the literal never lands." 1>&2
  exit 1
fi
echo "ci-secret-scan: clean ($RANGE)"
