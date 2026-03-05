# Duplicate Policy Reference

How the skill detects and handles duplicate Jira issues during the prepare-review-apply workflow.

---

## Overview

Duplicates are detected by searching Jira for existing issues that match the `story_id` custom field value. If no match is found by `story_id`, a secondary fallback search uses summary text similarity. The duplicate policy determines what happens when a match is found.

---

## Duplicate Detection Criteria

### Primary: story_id field match

The skill searches Jira with this JQL pattern:

```
project = "{PROJECT_KEY}" AND "{story_id_field}" ~ "{story_id_value}"
```

- `story_id_field` is configured in the project rules (default: `customfield_story_id`).
- This is the authoritative match. If a result is returned, the entry is considered a duplicate.

### Secondary: summary similarity

If no `story_id` match is found and a summary is provided, the skill performs a fallback search:

```
project = "{PROJECT_KEY}" AND summary ~ "{summary_text}"
```

- This is a fuzzy match. Results are treated as potential duplicates.
- Limited to 5 results to avoid false positives.

### Match threshold

- Any result from the primary search (story_id) is treated as a confirmed duplicate.
- Summary-based matches are treated as candidate duplicates (annotated with warnings, not auto-blocked).

---

## Four Duplicate Policies

The duplicate policy is set in the project rules YAML (`duplicate_policy` field) and can be overridden at prepare time via the `-DuplicatePolicy` parameter.

### Policy Mapping

The prepare script accepts these policy values as parameters:

| Prepare Parameter | Schema Value (in review MD) | Behavior |
|-------------------|----------------------------|----------|
| `ask` | `warn` | Show duplicates in review, let user decide |
| `update` | `warn` | Show duplicates in review, update existing on apply |
| `skip` | `skip` | Silently omit duplicates from review file |
| `create_new` | `warn` | Show duplicates in review, create new anyway |

---

## Policy Details

### 1. `ask` (default)

**Prepare parameter**: `-DuplicatePolicy ask`
**Schema mapping**: `warn`
**Use case**: Teams that want human review of every duplicate decision.

#### Behavior Flow

```
[Parse story entry]
    |
    v
[Search Jira for story_id match]
    |
    +-- No match --> [Add to review as status: pending]
    |
    +-- Match found --> [Add to review as status: pending]
                        [Annotate with duplicate warning]
                        [Include existing issue key in warning]
                            |
                            v
                        [User reviews and decides:]
                          - Change to "approved" --> create new issue
                          - Change to "rejected" --> skip this entry
                          - Edit story_id and approve --> create as distinct issue
```

#### Recommended For

- New projects where naming conventions are not yet established.
- Cross-team projects where duplicates may be intentional (different components).

---

### 2. `update`

**Prepare parameter**: `-DuplicatePolicy update`
**Schema mapping**: `warn`
**Use case**: Teams that want to keep existing issues in sync with the latest story definitions.

#### Behavior Flow

```
[Parse story entry]
    |
    v
[Search Jira for story_id match]
    |
    +-- No match --> [Add to review as status: pending]
    |
    +-- Match found --> [Add to review as status: pending]
                        [Annotate with "will update existing: {ISSUE_KEY}"]
                            |
                            v
                        [User reviews and decides:]
                          - Change to "approved" --> update existing issue fields
                          - Change to "rejected" --> skip, no update
```

> Note: In the current implementation, the apply script treats `warn` schema entries as creates (not updates). The `update` behavior is signaled through annotations in the review file and relies on the user confirming the intention. Future versions may introduce explicit `action: update` markers in the resolved YAML.

#### Recommended For

- Iterative development where story definitions evolve across sprints.
- Backlog grooming workflows where descriptions and priorities change.

---

### 3. `skip`

**Prepare parameter**: `-DuplicatePolicy skip`
**Schema mapping**: `skip`
**Use case**: Automated pipelines where duplicates should never produce new issues.

#### Behavior Flow

```
[Parse story entry]
    |
    v
[Search Jira for story_id match]
    |
    +-- No match --> [Add to review as status: pending]
    |
    +-- Match found --> [Omit from review file entirely]
                        [Log: "Duplicate skipped: {story_id} matches {ISSUE_KEY}"]
```

#### Recommended For

- CI/CD pipelines that auto-generate Jira issues from templates.
- Idempotent issue registration where running prepare multiple times should not create duplicates.

---

### 4. `create_new`

**Prepare parameter**: `-DuplicatePolicy create_new`
**Schema mapping**: `warn`
**Use case**: Teams that intentionally want separate issues even for similar stories.

#### Behavior Flow

```
[Parse story entry]
    |
    v
[Search Jira for story_id match]
    |
    +-- No match --> [Add to review as status: pending]
    |
    +-- Match found --> [Add to review as status: pending]
                        [Annotate: "Duplicate exists ({ISSUE_KEY}) but create_new policy active"]
                            |
                            v
                        [User reviews:]
                          - Approve --> create a new, separate Jira issue
                          - Reject --> skip
```

#### Recommended For

- Multi-sprint planning where the same feature appears in different epics.
- Fork/variant scenarios where a story is deliberately duplicated for different teams.

---

## Apply-Phase Duplicate Handling

During Phase B (apply), the duplicate policy from the review MD front matter determines behavior for validated entries:

| Front Matter Policy | Apply Behavior |
|--------------------|--------------------|
| `skip` | Entries already filtered out in prepare. If an entry somehow reaches apply, it is skipped with a log warning. |
| `warn` | Duplicate search is repeated. Matching entries proceed to creation with a duplicate warning logged. |
| `block` | Duplicate search is repeated. Matching entries are marked `status: duplicate` and skipped. |

---

## Edge Cases

### 1. story_id changes between prepare and apply

If a user edits the `story_id` in the review file between prepare and apply:

- The apply script re-searches Jira with the new `story_id`.
- If the new ID has no match, the entry is treated as new (no duplicate).
- If the new ID matches a different issue, the duplicate policy is re-applied.

### 2. Jira issue deleted between prepare and apply

If the duplicate detected during prepare is deleted from Jira before apply:

- The apply duplicate search returns no results.
- The entry is treated as new and created normally.
- The original duplicate warning in the review file becomes stale but harmless.

### 3. Multiple stories matching the same Jira issue

If two or more stories in the input MD share the same `story_id`:

- During prepare, both entries will match the same existing issue.
- The duplicate policy applies to each independently.
- With `skip`: both are omitted.
- With `warn`/`create_new`: both appear in the review with the same duplicate warning.
- With `ask`: both appear for user review. The user should reject one to avoid double-creation.

### 4. Jira MCP search failure

If the Jira search call fails during duplicate detection:

- The error is logged as a warning.
- The entry proceeds as if no duplicate was found (fail-open).
- A warning annotation is added: `"Duplicate check failed: {error}. Proceeding as non-duplicate."`

### 5. Empty story_id

If `story_id` is empty or auto-generated:

- The primary duplicate search (by field value) will not match anything meaningful.
- The secondary search (by summary) may return results.
- Summary matches are treated as candidate duplicates with lower confidence.

---

## Configuration Examples

### Conservative: Block all duplicates

```yaml
# projects/STRICT.yaml
duplicate_policy: "block"
```

Prepare command:

```
pwsh -File prepare.ps1 -Input stories.md -ProjectKey STRICT -DuplicatePolicy skip -Out review.md
```

### Permissive: Always create new

```yaml
# projects/PERMISSIVE.yaml
duplicate_policy: "warn"
```

Prepare command:

```
pwsh -File prepare.ps1 -Input stories.md -ProjectKey PERMISSIVE -DuplicatePolicy create_new -Out review.md
```

### Balanced: Ask on each (default)

```yaml
# projects/_base.yaml (or omit duplicate_policy to use default)
duplicate_policy: "warn"
```

Prepare command:

```
pwsh -File prepare.ps1 -Input stories.md -ProjectKey PROJ -DuplicatePolicy ask -Out review.md
```
