# Jira Review Markdown Schema

Canonical schema for the single Markdown file used as the review gate between draft and Jira registration.

---

## File Structure

```markdown
---
project_key: "{PROJECT_KEY}"
epic_key: "{EPIC_KEY}"
duplicate_policy: "skip | warn | block"
generated_at: "YYYY-MM-DDTHH:mm:ssZ"
---

# Jira Review: {PROJECT_KEY}

> Epic: {EPIC_KEY} | Duplicate Policy: {policy} | Generated: {timestamp}

## Story: {summary_short}

| Field       | Value                                 |
| ----------- | ------------------------------------- |
| summary     | {issue summary}                       |
| description | {issue description, may be multiline} |
| issuetype   | Story                                 |
| labels      | {comma-separated labels}              |
| story_id    | {story_id_field value}                |
| priority    | {priority: High / Medium / Low}       |
| status      | pending                               |
| jira_key    |                                       |
| error       |                                       |

---

(repeat `## Story` sections for each entry)
```

---

## Required Sections

Every review Markdown must contain these top-level elements:

| Section                | Description                                                    |
| ---------------------- | -------------------------------------------------------------- |
| YAML front matter      | Project key, epic key, duplicate policy, generation timestamp. |
| `# Jira Review: {KEY}` | Document title with project key.                               |
| `## Story: {summary}`  | One section per story entry (repeatable).                      |
| Field table            | Structured key-value table inside each Story section.          |

---

## Required Fields (per Story entry)

These fields must be present in every Story field table:

| Field         | Type   | Required | Description                                                                                |
| ------------- | ------ | -------- | ------------------------------------------------------------------------------------------ |
| `summary`     | string | yes      | Jira issue summary (title).                                                                |
| `description` | string | yes      | Jira issue description body. Supports multiline.                                           |
| `issuetype`   | string | yes      | Fixed to `Story` for this schema version.                                                  |
| `labels`      | string | yes      | Comma-separated list. Validated against `allowed_labels` in project rules.                 |
| `story_id`    | string | yes      | Unique story identifier. Field name is configurable via `story_id_field` in project rules. |
| `priority`    | string | yes      | `High`, `Medium`, or `Low`.                                                                |
| `status`      | enum   | yes      | Entry lifecycle status (see below).                                                        |
| `jira_key`    | string | no       | Populated after successful Jira registration.                                              |
| `error`       | string | no       | Populated when registration fails.                                                         |

---

## Status Values

Each story entry progresses through these statuses:

| Status       | Set By             | Meaning                                                                             |
| ------------ | ------------------ | ----------------------------------------------------------------------------------- |
| `pending`    | Phase A (prepare)  | Draft entry awaiting user review.                                                   |
| `approved`   | User (review gate) | User has approved this entry for registration.                                      |
| `rejected`   | User (review gate) | User has rejected this entry; it will be skipped.                                   |
| `registered` | Phase B (apply)    | Successfully created in Jira. `jira_key` is populated.                              |
| `error`      | Phase B (apply)    | Registration failed. `error` field contains details.                                |
| `duplicate`  | Phase A (prepare)  | Detected as duplicate during prepare phase. Behavior depends on `duplicate_policy`. |

### Status Transition Rules

```
pending -> approved      (user action)
pending -> rejected      (user action)
approved -> registered   (successful Jira creation)
approved -> error        (failed Jira creation)
pending -> duplicate     (duplicate detection with block policy)
```

- Only `approved` entries are eligible for Phase B registration.
- `pending` entries at Phase B time generate a warning but are not registered.
- `rejected` and `duplicate` entries are permanently skipped.

---

## Front Matter Fields

| Field              | Type     | Required | Description                                   |
| ------------------ | -------- | -------- | --------------------------------------------- |
| `project_key`      | string   | yes      | Target Jira project key (e.g., `PROJ`).       |
| `epic_key`         | string   | yes      | Target epic issue key (e.g., `PROJ-100`).     |
| `duplicate_policy` | enum     | yes      | One of `skip`, `warn`, `block`.               |
| `generated_at`     | ISO 8601 | yes      | Timestamp when the review file was generated. |

---

## Description Format

`description` must use structured Markdown for Jira readability. Plain text paragraphs are not allowed.

### Structure

```
**목적**
{한 줄 요약}

**{섹션명}**
- 항목 1
- 항목 2
```

### Rules

1. Start with `**목적**` followed by a one-line summary of the task.
2. Add 1+ body sections with bold headers: `**주요 기능**`, `**표시 항목**`, `**응답 데이터**`, `**제약 조건**`, `**동작**` etc.
3. Use `- ` bullet lists under each section. Nested bold (`**key**: value`) for compound items.
4. Separate sections with a blank line.
5. In review MD table cells, use `<br>` for line breaks. The apply phase sends raw Markdown (with `\n`) to Jira API.

### Example (WEB)

```
**목적**
비행 완료 후 불법 주정차 분석 결과 화면 구현

**분석 상태 표시**
- 업로드 대기중
- 업로드중
- 분석중
- 분석 완료

**분석 완료 시**
- 위반 차량 목록 표시
```

### Example (SERVER)

```
**목적**
탐지 결과 조회 API 구현

**응답 데이터**
- **분석 상태**: 업로드 대기중 / 업로드중 / 분석중 / 분석 완료
- **위반 차량 목록** (분석 완료 시)
```

---

## Parsing Rules

1. **Front matter** is delimited by `---` lines and parsed as YAML.
2. **Story sections** are identified by `## Story:` heading prefix.
3. **Field tables** use standard Markdown table syntax with `Field` and `Value` columns.
4. **Multiline description**: If `description` value exceeds one table cell, use an HTML `<details>` block or a fenced block immediately after the table.

---

## Validation Checklist

Before Phase B apply, every `approved` entry must pass:

- [ ] `summary` is non-empty
- [ ] `description` is non-empty
- [ ] `issuetype` equals `Story`
- [ ] `labels` values are all in `allowed_labels` (if defined in project rules)
- [ ] `story_id` is non-empty
- [ ] `priority` is one of `High`, `Medium`, `Low`
- [ ] `status` is `approved`
