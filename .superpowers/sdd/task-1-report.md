# Task 1 Implementer Report

Status: DONE_WITH_CONCERNS

Commit: abd6b84 (feat: add read-only workspace auth foundation)

Changed files:
- package.json
- scripts/agent-office/lib/config.mjs
- scripts/agent-office/lib/auth-provider.mjs
- scripts/agent-office/test/config.test.mjs
- scripts/agent-office/test/auth-provider.test.mjs

Independent verification:
- `timeout 60s npm run office:test`: PASS, 3 tests, 0 failures.
- `timeout 30s node --check scripts/agent-office/lib/config.mjs && timeout 30s node --check scripts/agent-office/lib/auth-provider.mjs`: PASS.
- Existing `npm run check` was started but Vite build did not finish after approximately four minutes and was interrupted; no existing-project check result is claimed.

Concern requiring review/fix:
- `auth-provider.mjs` defines a lazy `createOAuthClient` helper but `OAuthUserProvider#getAuthorizedClient` and `authorizeWithLoopback` still reference an undefined `google` binding. The MockProvider tests pass because the live path is not invoked, but real OAuth will fail with `ReferenceError`.

## Reviewer findings fix

Status: DONE

Commit: `6bf4fb6` (`fix: harden read-only workspace auth`)

Changed files:
- `scripts/agent-office/lib/config.mjs`
- `scripts/agent-office/lib/auth-provider.mjs`
- `scripts/agent-office/test/config.test.mjs`
- `scripts/agent-office/test/auth-provider.test.mjs`

Fixes applied:
- Routed both OAuth client constructions through the existing lazy `createOAuthClient` helper, with a constructor-injected factory used by the local regression test.
- Added `fs.chmod(tokenPath, 0o600)` after token writes so an existing token file is secured after overwrite.
- Resolved OAuth secret and token paths and reject paths inside `process.cwd()`; existing external absolute paths continue to resolve unchanged.

Test-first evidence:
- Command: `node --test --test-name-pattern='loadBriefingConfig|OAuthUserProvider' scripts/agent-office/test/*.test.mjs`
- Initial output: `OAuthUserProvider uses the lazy client and secures an overwritten token` failed with `ReferenceError: google is not defined`; `loadBriefingConfig rejects OAuth paths inside the repository` failed with `Missing expected exception.`
- After the minimal implementation, output: 4 passed, 0 failed, 1 skipped (the unrelated MockProvider test was filtered by name).

Required verification:
- Command: `timeout 60s npm run office:test`
- Output: PASS — 5 tests passed, 0 failed, 0 skipped; duration `4233.236147 ms`.
- Command: `timeout 30s node --check scripts/agent-office/lib/config.mjs`
- Output: PASS — exit code 0 with no output.
- Command: `timeout 30s node --check scripts/agent-office/lib/auth-provider.mjs`
- Output: PASS — exit code 0 with no output.

Remaining concerns:
- The full Vite check was intentionally not run, per instruction, because it is known to hang in this environment.
- The regression test injects a local fake OAuth client and does not import `googleapis`; it verifies dependency wiring, loopback handling, and token permissions without network access. A real consent flow still requires operator-provided external credentials and interactive verification.

## Task 1 remaining credential-path review fix

Status: DONE

Commit: `bb538e7` (`fix: anchor credential path validation`)

Changed files:
- `scripts/agent-office/lib/config.mjs`
- `scripts/agent-office/test/config.test.mjs`

TDD evidence:
- RED command: `node --test --test-name-pattern='absolute repository secret path' scripts/agent-office/test/config.test.mjs`
- RED output: 1 matching test failed with `AssertionError: Missing expected exception.`; 3 nonmatching tests skipped; exit status 1; duration `244.432913 ms`.
- GREEN command: `node --test --test-name-pattern='absolute repository secret path' scripts/agent-office/test/config.test.mjs`
- GREEN output: 1 matching test passed; 3 nonmatching tests skipped; 0 failures; duration `207.939683 ms`.

Required verification:
- `timeout 60s npm run office:test`
- Output: 6 passed, 0 failed, 0 skipped, 0 todo; duration `4255.308931 ms`; exit status 0.
- `timeout 30s node --check scripts/agent-office/lib/config.mjs`
- Output: no output; exit status 0.
- `timeout 30s node --check scripts/agent-office/lib/auth-provider.mjs`
- Output: no output; exit status 0.

Fix details:
- The repository root is derived from `config.mjs` via `import.meta.url` and `fileURLToPath`, then canonicalized with `fs.realpathSync.native` when available.
- Existing credential paths are also canonicalized when available before the stable-root containment check. The new regression changes to a temporary external cwd, uses the test source file as a non-secret existing absolute repository path, and restores cwd in `finally`.

## Task 1 P1 review fixes

Status: DONE

Fixes applied:
- Loopback OAuth now generates a 32-byte `node:crypto` random state value, includes it in the authorization URL, and requires an exact callback match before accepting a code.
- The loopback server closes in `finally` after successful, rejected, token-exchange, or callback-error paths; the rejection regression verifies its port is closed.
- Credential containment now canonicalizes the nearest existing target parent before evaluating the stable repository root, rejecting a missing token path through a symlink into the repository while preserving external paths.

TDD evidence:
- RED: `node --test --test-name-pattern='mismatched state|symlinked repository|secures an overwritten token' scripts/agent-office/test/*.test.mjs` failed with missing state, missing rejection, and missing containment exception.
- GREEN: the same focused command passed 3 matching tests with 0 failures.

Required verification:
- `timeout 60s npm run office:test` passed 8 tests with 0 failures.
- `node --check scripts/agent-office/lib/auth-provider.mjs` and `node --check scripts/agent-office/lib/config.mjs` passed.
