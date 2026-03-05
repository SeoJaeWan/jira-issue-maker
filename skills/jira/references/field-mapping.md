# Field Mapping Reference

Mapping between the Jira Review MD schema fields and Jira REST API / MCP fields.

---

## Standard Field Mapping

These fields are supported out-of-the-box and do not require custom configuration.

| MD Schema Field | Jira API Field | Type | Notes |
|----------------|---------------|------|-------|
| `summary` | `summary` | string | Issue title. Required. Max 255 characters. |
| `description` | `description` | string | Issue body. Supports Jira wiki markup or ADF. |
| `issuetype` | `issuetype.name` | string | `Story`, `Bug`, `Task`. Wrapped in `{ name: "..." }`. |
| `labels` | `labels` | string[] | Comma-separated in MD, converted to JSON array on apply. |
| `priority` | `priority.name` | string | `High`, `Medium`, `Low`. Wrapped in `{ name: "..." }`. |
| `story_id` | *(custom field)* | string | Mapped via `story_id_field` in project rules. |
| `epic_link` | `epic.key` | string | Epic issue key. Wrapped in `{ key: "..." }`. |
| `status` | *(workflow only)* | enum | Internal to the review MD lifecycle. Not sent to Jira. |
| `jira_key` | *(output only)* | string | Populated after successful registration. Not sent to Jira. |
| `error` | *(output only)* | string | Populated on registration failure. Not sent to Jira. |

---

## Custom Field Configuration

Custom fields bridge logical names used in the MD schema to Jira custom field IDs. They are configured in the `custom_field_mapping` section of the project rules YAML.

### Configuration Syntax

In `projects/{PROJECT_KEY}.yaml`:

```yaml
custom_field_mapping:
  logical_name: "customfield_NNNNN"
  another_field: "customfield_MMMMM"
```

### How It Works

1. During **prepare**, custom fields are stored as key-value pairs in the `custom_fields` dictionary of each story entry in the resolved YAML.
2. During **apply**, the `jira-client.ps1` `New-JiraIssue` function iterates over `custom_fields` and maps each key to its Jira field ID.
3. If a logical name does not appear in `custom_field_mapping`, it is passed through as-is (assumed to already be a Jira field ID).

### Example

Project rules (`DEMO.yaml`):

```yaml
custom_field_mapping:
  story_id: "customfield_10100"
  component: "customfield_10200"
  sprint: "customfield_10300"
```

Resolved YAML output:

```yaml
issues:
  - summary: "Add login page"
    custom_fields:
      customfield_10100: "DEMO-001"
      customfield_10200: "web-app"
      customfield_10300: "Sprint 5"
```

---

## Override Hierarchy

Field values are resolved in this priority order (highest wins):

1. **Review MD entry** -- User-edited values in the approved review file.
2. **Project rules** (`{PROJECT_KEY}.yaml`) -- Project-specific defaults and constraints.
3. **Base rules** (`_base.yaml`) -- Global defaults.
4. **Script defaults** -- Hardcoded fallbacks in `prepare.ps1` / `apply.ps1`.

For `custom_field_mapping` specifically:

- Project rules completely override base rules (no merge).
- If `custom_field_mapping` is `{}` in the project rules, no custom field mapping is applied even if the base defines some.

---

## Supported Field Types

Each Jira field type has specific formatting requirements when sent via the API.

### text (string)

Plain text value. Used for `summary`, `description`, and most custom text fields.

```yaml
# MD table row
| summary | Implement user login |

# Jira API payload
{ "summary": "Implement user login" }
```

### select (single-select)

Object with a `name` or `value` property. Used for `issuetype`, `priority`, and single-select custom fields.

```yaml
# MD table row
| priority | High |

# Jira API payload
{ "priority": { "name": "High" } }
```

For custom single-select fields:

```yaml
# Project rules
custom_field_mapping:
  environment: "customfield_10600"

# Jira API payload
{ "customfield_10600": { "value": "Production" } }
```

### multi-select

Array of objects with `value` properties. Used for custom multi-select fields.

```yaml
# MD table row (comma-separated)
| affected_versions | 1.0, 1.1, 1.2 |

# Jira API payload
{ "customfield_10700": [{ "value": "1.0" }, { "value": "1.1" }, { "value": "1.2" }] }
```

### labels (string array)

Array of plain strings. Special case -- labels do not use object wrapping.

```yaml
# MD table row (comma-separated)
| labels | frontend, backend, bug |

# Jira API payload
{ "labels": ["frontend", "backend", "bug"] }
```

### date

ISO 8601 date string (`YYYY-MM-DD`).

```yaml
# MD table row
| due_date | 2026-04-15 |

# Jira API payload
{ "customfield_10800": "2026-04-15" }
```

### number

Numeric value. Used for story points and other numeric custom fields.

```yaml
# MD table row
| story_points | 5 |

# Jira API payload
{ "customfield_10400": 5 }
```

### user (assignee / reporter)

Object with `accountId` property. Requires Jira user lookup.

```yaml
# MD table row
| assignee | john.doe |

# Jira API payload (requires accountId resolution)
{ "assignee": { "accountId": "5b10a2844c20165700ede21g" } }
```

> Note: User fields require an additional Jira API call to resolve display name or email to `accountId`. This is not automatically handled by the current skill scripts -- the caller must resolve user IDs before populating the review MD.

---

## Adding a New Custom Field

Step-by-step guide to add a project-specific custom field:

1. **Identify the Jira field ID**: Look up the field ID in Jira Admin > Custom Fields, or query `jira_get_fields` via MCP.

2. **Add to project rules**: Add the logical-to-physical mapping in `custom_field_mapping`:
   ```yaml
   custom_field_mapping:
     my_new_field: "customfield_99999"
   ```

3. **Add to required_fields** (optional): If the field is mandatory:
   ```yaml
   required_fields:
     - summary
     - description
     - issuetype
     - labels
     - story_id
     - priority
     - my_new_field
   ```

4. **Add to validation_rules** (optional): If the field needs value constraints:
   ```yaml
   validation_rules:
     my_new_field_enum:
       - value_a
       - value_b
   ```

5. **Update the review MD template** (optional): If the field should appear in the review table, the prepare script will include any field listed in `required_fields` automatically. For additional non-required fields, extend the prepare script's Step 5 to include them.
