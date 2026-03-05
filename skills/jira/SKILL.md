---
name: jira
description: Two-phase Jira issue registration from user story Markdown. Generates a review MD (prepare), waits for user approval, then registers approved entries to Jira via MCP (apply). Use when user asks to register user stories to Jira, create Jira issues from Markdown, bulk-register stories, or mentions "jira 등록", "스토리 등록", "이슈 등록", "Jira 일괄 등록". Requires Jira MCP (atlassian-rovo) connection.
model: sonnet
---

# jira

Register Jira issues from user story Markdown through a two-phase gate:
**prepare** (draft review file) → **user review** → **apply** (create Jira issues).

## Prerequisites

1. Jira MCP server (`atlassian-rovo`) connected and authenticated.
2. User has issue-creation permissions for the target project.
3. Input Markdown uses `## ` headings per story with summary, description.

## Workflow

### Phase A: prepare

Execute queries in strict order — do not skip or reorder:

1. **Project key** — If user did not provide a key upfront:
    1. Call `getAccessibleAtlassianResources` to obtain `cloudId`.
    2. Call `getVisibleJiraProjects` (with `cloudId`, `action:"create"`, `expandIssueTypes:true`).
    3. Present the results as a selection table (project key, name, available issue types).
    4. Let user pick a project from the list.
       Then load `./projects/{KEY}.yaml`, fallback to `./projects/_base.yaml`.
2. **Epic** — Use `default_epic` from rules or query Jira (`issuetype = Epic AND project = {KEY}`). User confirms.
3. **Duplicate policy** — Read from rules, present to user: `skip` / `warn` / `block`. User confirms or overrides.

Then:

4. Parse input MD into story entries (see `references/md-schema.md` for schema).
5. Infer issue type per entry (default: Story; keyword-based: Bug, Task).
6. Run duplicate check via Jira MCP search on `story_id` field.
7. Write `description` in structured Markdown (see `references/md-schema.md` § Description Format).
8. Generate review MD at user-specified path (default: `.ai/jira-review/{task}/{task}.md`).
    - YAML front matter: `project_key`, `epic_key`, `duplicate_policy`, `generated_at`
    - Each story as `## Story:` section with field table, all `status: pending`
    - Warnings in `<!-- WARNINGS: -->` comments

**Stop here. Do not proceed to Phase B without explicit user approval.**

### User Review Gate

User edits the review MD:

- `status: pending` → `approved` (register) or `rejected` (skip)
- Edit any field values as needed

Wait for user signal (e.g., "apply", "등록해줘", "register approved").

### Phase B: apply

1. Re-read review MD, extract only `status: approved` entries.
2. Validate all approved entries against project rules (`required_fields`, `allowed_labels`).
3. If validation fails → halt, report errors per entry. Do not create any issues.
4. Apply duplicate policy for each entry.
5. Show preview table to user. Without explicit confirmation, stop here.
6. With confirmation → call Jira MCP to create/update issues:
    - `createJiraIssue` for new issues
    - `editJiraIssue` for updates (when duplicate policy = `update`)
7. Update review MD: `status: registered` + `jira_key`, or `status: error` + error message.
8. Output summary report.

## Jira MCP Tool Mapping

| Operation            | MCP Tool                           |
| -------------------- | ---------------------------------- |
| List cloud resources | `getAccessibleAtlassianResources`  |
| List projects        | `getVisibleJiraProjects`           |
| Search issues        | `searchJiraIssuesUsingJql`         |
| Create issue         | `createJiraIssue`                  |
| Update issue         | `editJiraIssue`                    |
| Get issue types      | `getJiraProjectIssueTypesMetadata` |
| Get fields           | `getJiraIssueTypeMetaWithFields`   |

## Scripts (Node.js)

Available for automated/batch execution:

```
node scripts/prepare.mjs --input <md> --project-key <KEY> --epic-mode <none|select|create> --duplicate-policy <ask|update|skip|create_new> --out <path> [--dry-run]
node scripts/apply.mjs   --draft <reviewed-md> [--confirm] [--dry-run] [--out <report-path>]
```

Common modules in `scripts/common/`: `parser.mjs`, `infer-issue-type.mjs`, `transform-to-yaml.mjs`, `yaml-utils.mjs`.

## References

| File                             | When to Read                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `references/md-schema.md`        | When generating or parsing review MD — defines required sections, fields, status values.    |
| `references/field-mapping.md`    | When mapping MD fields to Jira API fields, adding custom fields, or debugging field errors. |
| `references/duplicate-policy.md` | When explaining duplicate handling, configuring policy, or debugging duplicate detection.   |

## Project Rules

| File                  | Purpose                                                                             |
| --------------------- | ----------------------------------------------------------------------------------- |
| `projects/_base.yaml` | Default rules (required_fields, story_id_field, duplicate_policy, etc.)             |
| `projects/{KEY}.yaml` | Project-specific overrides (allowed_labels, custom_field_mapping, validation_rules) |

Project-specific values override base defaults. If no project file exists, `_base.yaml` applies with a warning.

## Guardrails

- **Never create Jira issues without explicit user approval.**
- Enforce query order: project key → epic → duplicate policy.
- Do not register `pending` or `rejected` entries.
- Halt and report on validation errors — do not silently skip.
- Project rules take precedence over Jira MCP query results.
- Output language: Korean.
