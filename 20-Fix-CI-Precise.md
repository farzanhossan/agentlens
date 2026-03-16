Read the project context: this is AgentLens, an AI agent observability
platform. Stack: NestJS, BullMQ, Redis, PostgreSQL (TypeORM),
Elasticsearch, Cloudflare Workers (Hono.js), React + Vite, TypeScript strict.
Senior backend engineer audience. Production-ready code only.

Fix these EXACT CI failures. Every error location is known. No investigation needed.
Just fix and push.

---

## FIX 1 — packages/sdk-anthropic/src/patch.ts (ALL lint errors)

Errors on these exact lines:
- L44:  Unsafe member access `._isInitialized` on an `error` typed value
- L53:  `any` overrides all other types in this union type
- L54:  Unsafe member access `._getProjectId` + Unsafe call + Unsafe assignment
- L57:  Unsafe call + Unsafe assignment
- L58:  Unsafe call + Unsafe assignment

Root cause: The catch blocks are using the caught `error` variable as if it
has specific properties, but TypeScript strict mode types catch variables as
`unknown`. Also a union type contains `any` which overrides everything.

Open the file: packages/sdk-anthropic/src/patch.ts

Read the FULL file content first, then apply these fixes:

### Fix catch blocks (L44, L54, L57, L58)

Replace every catch block that looks like this:
```typescript
} catch (error) {
  if (error._isInitialized) { ... }    // L44 — unsafe member access
  const result = error._getProjectId() // L54 — unsafe member access + call
  span.setError(error)                 // L57 — unsafe assignment
  throw error()                        // L58 — unsafe call (wrong, should be throw not call)
}
```

With properly typed catch blocks:
```typescript
} catch (error: unknown) {
  const err = error instanceof Error ? error : new Error(String(error))

  // If checking properties, use type narrowing:
  if (err instanceof Error && '_isInitialized' in err) {
    // access safely
  }

  span.setError(err)   // now safe — err is Error type
  throw err            // throw the error, never call it as a function
}
```

### Fix union type with `any` (L53)

Find the type definition around L53 that looks like:
```typescript
type SomeType = string | any | undefined   // ❌ 'any' overrides all
```

Replace with:
```typescript
type SomeType = string | unknown | undefined  // ✅ or remove 'any' entirely
```

OR if it's a function parameter:
```typescript
// ❌ BAD
function doSomething(value: string | any) {}

// ✅ GOOD
function doSomething(value: string | unknown) {}
// OR just:
function doSomething(value: unknown) {}
```

After reading the actual file, apply the correct fix that matches the real code.
Rewrite the entire patch.ts file with all fixes applied.

Verify fix:
```bash
cd packages/sdk-anthropic
pnpm lint
```
Expected: 0 errors in patch.ts

---

## FIX 2 — packages/sdk-python (exit code 1)

Read the actual test output first:
```bash
cd packages/sdk-python
pip install -e ".[dev]" --break-system-packages 2>&1
python -m pytest tests/ -v --tb=long 2>&1
```

Then fix based on what you see. Most likely issues:

### Fix A — Missing dev dependencies in pyproject.toml
```toml
[project.optional-dependencies]
dev = [
  "pytest>=7.0.0",
  "pytest-asyncio>=0.21.0",
  "pytest-mock>=3.11.0",
  "respx>=0.20.0",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
python_files = ["test_*.py", "*_test.py"]
python_functions = ["test_*"]
python_classes = ["Test*"]
```

### Fix B — Missing tests/__init__.py
```bash
touch packages/sdk-python/tests/__init__.py
```

### Fix C — Import errors in test files
If tests import from wrong paths, fix to match actual module structure:
```python
# ❌ BAD
from agentlens.core import Span

# ✅ GOOD — match actual file structure
from agentlens.span import Span
from agentlens.tracer import Tracer
from agentlens.agentlens import AgentLens
```

### Fix D — Async test issues
If async tests fail, ensure pytest-asyncio is configured:
```python
# In test files, mark async tests:
import pytest

@pytest.mark.asyncio
async def test_something():
    ...
```

### Fix E — CI workflow Python step
Update .github/workflows/ci.yml Python test job to be more explicit:
```yaml
test-python:
  name: Test (Python SDK)
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - uses: actions/setup-python@v5
      with:
        python-version: '3.11'

    - name: Install dependencies
      run: |
        python -m pip install --upgrade pip
        cd packages/sdk-python
        pip install -e ".[dev]"

    - name: Run tests
      run: |
        cd packages/sdk-python
        python -m pytest tests/ -v --tb=short --no-header

    - name: Show installed packages (debug)
      if: failure()
      run: pip list
```

Verify fix locally:
```bash
cd packages/sdk-python
python -m pytest tests/ -v --tb=short
```
Expected: all tests pass, exit code 0.

---

## FIX 3 — Commit everything

After both fixes are verified locally:

```bash
# Stage only the changed files
git add packages/sdk-anthropic/src/patch.ts
git add packages/sdk-python/pyproject.toml
git add packages/sdk-python/tests/__init__.py  # if created
git add .github/workflows/ci.yml

# Commit with clear message
git commit -m "fix(ci): fix anthropic patcher lint errors + python test setup

- Fix unsafe error type handling in sdk-anthropic/src/patch.ts (L44,53,54,57,58)
- Type-narrow caught errors using instanceof Error pattern
- Fix 'any' union type override at L53
- Add pytest dev dependencies to sdk-python pyproject.toml
- Configure pytest.ini_options for asyncio support
- Fix CI workflow Python install step"

git push origin main
```

---

## EXPECTED CI RESULT

```
✅ Install dependencies
✅ Test (Python SDK)      ← FIXED
✅ Lint                   ← FIXED (patch.ts all 11 errors)
✅ Build & type-check
✅ Test (Node)
✅ Docker build validation
```

Watch live at: https://github.com/farzanhossan/agentlens/actions

Do NOT touch npm publishing or production deploy until you see all 6 green checkmarks.
