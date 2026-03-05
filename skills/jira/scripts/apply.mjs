#!/usr/bin/env node
/**
 * Phase B: Apply approved entries from a reviewed Jira MD to Jira via MCP.
 *
 * Usage:
 *   node apply.mjs --draft <reviewed-md> [--confirm] [--dry-run] [--out <report-path>]
 *
 * Note: Jira API calls (create/update) are handled by Claude MCP tools directly.
 * This script handles parsing, validation, duplicate checking output, preview,
 * and report generation. The actual Jira MCP calls are orchestrated by Claude.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformToYaml } from './common/transform-to-yaml.mjs';
import { readSimpleYaml, mergeRules } from './common/yaml-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const skillRoot = dirname(__dirname);

// ── Parse CLI args ──────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--draft': case '-Draft': args.draft = argv[++i]; break;
      case '--confirm': case '-Confirm': args.confirm = true; break;
      case '--dry-run': case '-DryRun': args.dryRun = true; break;
      case '--out': case '-Out': args.out = argv[++i]; break;
    }
  }
  return args;
}

function log(msg, level = 'INFO') {
  console.log(`[${level}] ${msg}`);
}

function pad(s, len) {
  return String(s).padEnd(len);
}

function main() {
  const args = parseArgs(process.argv);
  const { draft, confirm = false, dryRun = false } = args;

  if (!draft) {
    console.error('Usage: node apply.mjs --draft <reviewed-md> [--confirm] [--dry-run] [--out <path>]');
    process.exit(1);
  }

  const now = new Date();
  const runId = now.toISOString().replace(/[-:T]/g, '').substring(0, 15).replace(/^(\d{8})(\d{6}).*/, '$1-$2');
  const draftDir = dirname(draft) || '.';
  const outFile = args.out || join(draftDir, `${runId}.result.md`);

  log('=== Jira MD Review Apply Pipeline ===');
  log(`Draft: ${draft}`);
  log(`Run ID: ${runId}`);
  log(`Confirm: ${confirm}`);
  if (dryRun) log('DryRun mode enabled -- Jira API calls will be simulated.', 'WARN');

  // ── Step 1: Parse Draft MD ────────────────────────────────────
  log('Step 1: Parsing draft MD and extracting approved entries...');

  if (!existsSync(draft)) {
    log(`Draft file not found: ${draft}`, 'ERROR');
    process.exit(1);
  }

  const resolvedYamlPath = join(draftDir, `${runId}.resolved.yaml`);
  const transformResult = transformToYaml({ draftPath: draft, outputPath: resolvedYamlPath });

  if (transformResult.errors.length > 0) {
    for (const err of transformResult.errors) log(err, 'ERROR');
    log('Transform failed. Aborting.', 'ERROR');
    process.exit(1);
  }

  const approvedIssues = transformResult.issues;
  const frontMatter = transformResult.frontMatter;
  const skippedEntries = transformResult.skipped;

  const projectKey = frontMatter.project_key || '';
  const epicKey = frontMatter.epic_key || '';
  const dupPolicy = frontMatter.duplicate_policy || 'warn';

  log(`Project: ${projectKey} | Epic: ${epicKey || '(none)'} | Duplicate Policy: ${dupPolicy}`);
  log(`Approved entries: ${approvedIssues.length}`);
  log(`Skipped entries: ${skippedEntries.length}`);
  log(`Resolved YAML: ${resolvedYamlPath}`);

  if (approvedIssues.length === 0) {
    log('No approved entries found. Nothing to register.', 'WARN');
  }

  // ── Step 2: Load project rules and validate ───────────────────
  log('Step 2: Loading project rules and validating...');
  const baseRules = readSimpleYaml(join(skillRoot, 'projects/_base.yaml'));
  const projectRulesData = readSimpleYaml(join(skillRoot, `projects/${projectKey}.yaml`));
  const rules = mergeRules(baseRules, projectRulesData);

  const requiredFields = Array.isArray(rules.required_fields) && rules.required_fields.length > 0
    ? rules.required_fields
    : ['summary', 'description', 'issuetype', 'labels', 'story_id', 'priority'];

  const allowedLabels = Array.isArray(rules.allowed_labels) && rules.allowed_labels.length > 0
    ? rules.allowed_labels
    : [];

  log(`Required fields: ${requiredFields.join(', ')}`);
  if (allowedLabels.length > 0) log(`Allowed labels: ${allowedLabels.join(', ')}`);

  // ── Step 3: Validate each approved issue ──────────────────────
  log('Step 3: Validating approved entries...');
  const validPriorities = ['High', 'Medium', 'Low'];
  const validIssues = [];
  const validationErrors = [];

  for (const issue of approvedIssues) {
    const issueErrors = [];

    for (const rf of requiredFields) {
      if (!issue[rf] || !String(issue[rf]).trim()) {
        issueErrors.push(`Required field missing or empty: ${rf}`);
      }
    }

    if (issue.priority && issue.priority.trim() && !validPriorities.includes(issue.priority)) {
      issueErrors.push(`Invalid priority: ${issue.priority}. Expected: High, Medium, or Low.`);
    }

    if (allowedLabels.length > 0 && issue.labels && issue.labels.trim()) {
      const issueLabels = issue.labels.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
      for (const lbl of issueLabels) {
        if (!allowedLabels.includes(lbl)) {
          issueErrors.push(`Label not in allowed list: ${lbl} (allowed: ${allowedLabels.join(', ')})`);
        }
      }
    }

    if (issueErrors.length > 0) {
      validationErrors.push({ summary: issue.summary, storyId: issue.story_id, errors: issueErrors });
      log(`  FAIL: [${issue.story_id}] ${issue.summary} -- ${issueErrors.length} error(s)`, 'ERROR');
    } else {
      validIssues.push(issue);
      log(`  OK: [${issue.story_id}] ${issue.summary}`);
    }
  }

  log(`Validation complete: ${validIssues.length} valid, ${validationErrors.length} failed`);

  // ── Step 4: Output for duplicate checking ─────────────────────
  // Note: Actual duplicate checking is done by Claude via MCP searchJiraIssuesUsingJql.
  // This script outputs the data needed for Claude to perform the check.
  log('Step 4: Duplicate check data prepared (Claude handles via MCP)...');

  // ── Step 5: Preview table ─────────────────────────────────────
  log('');
  log('=== Registration Preview ===');
  log('');

  const previewItems = validIssues.map((item, i) => ({
    index: i + 1,
    action: 'CREATE',
    storyId: item.story_id,
    summary: item.summary.length > 50 ? item.summary.substring(0, 47) + '...' : item.summary,
    type: item.issuetype,
    priority: item.priority,
    labels: item.labels,
  }));

  log(`${pad('#', 4)} ${pad('Action', 8)} ${pad('StoryID', 12)} ${pad('Summary', 50)} ${pad('Type', 8)} ${pad('Priority', 8)} Labels`);
  log(`${pad('---', 4)} ${pad('------', 8)} ${pad('---------', 12)} ${pad('-'.repeat(50), 50)} ${pad('------', 8)} ${pad('------', 8)} ------`);
  for (const item of previewItems) {
    log(`${pad(item.index, 4)} ${pad(item.action, 8)} ${pad(item.storyId, 12)} ${pad(item.summary, 50)} ${pad(item.type, 8)} ${pad(item.priority, 8)} ${item.labels}`);
  }

  if (skippedEntries.length > 0) {
    log('');
    log('Skipped entries:');
    for (const s of skippedEntries) log(`  - [${s.summary}] Status: ${s.status} -- ${s.reason}`, 'WARN');
  }

  if (validationErrors.length > 0) {
    log('');
    log('Validation failures (not registered):');
    for (const ve of validationErrors) {
      log(`  - [${ve.storyId}] ${ve.summary}:`, 'ERROR');
      for (const e of ve.errors) log(`      ${e}`, 'ERROR');
    }
  }

  log('');
  log(`Total: ${previewItems.length} to register, ${skippedEntries.length} skipped, ${validationErrors.length} failed validation`);

  // ── Output result as JSON for Claude to consume ───────────────
  const resultData = {
    runId,
    projectKey,
    epicKey,
    dupPolicy,
    validIssues,
    validationErrors,
    skippedEntries,
    previewItems,
    draftPath: draft,
    resolvedYamlPath,
    outFile,
    confirm,
    dryRun,
  };

  // Write JSON for Claude to read and process
  const jsonOutPath = join(draftDir, `${runId}.apply-data.json`);
  writeFileSync(jsonOutPath, JSON.stringify(resultData, null, 2), 'utf-8');
  log(`Apply data written: ${jsonOutPath}`);

  if (!confirm) {
    log('');
    log('Preview only. Use --confirm to execute Jira registration.');
    generatePreviewReport(resultData, outFile);
    process.exit(0);
  }

  // When --confirm is used, Claude reads the JSON and calls MCP tools.
  // After MCP calls, Claude updates the draft MD and generates the final report.
  log('');
  log('=== Confirm mode ===');
  log(`Claude should now read ${jsonOutPath} and call Jira MCP tools to create/update issues.`);
  log(`After completion, update the draft file and generate the result report at: ${outFile}`);
}

function generatePreviewReport(data, outFile) {
  const { runId, projectKey, epicKey, previewItems, skippedEntries, validationErrors, draftPath, dryRun } = data;
  const timestamp = new Date().toISOString();

  const lines = [
    '---',
    `run_id: "${runId}"`,
    `project_key: "${projectKey}"`,
    `epic_key: "${epicKey}"`,
    `draft_file: "${draftPath}"`,
    `mode: "preview"`,
    `generated_at: "${timestamp}"`,
    '---',
    '',
    `# Jira Registration Preview: ${projectKey}`,
    '',
    `> Run: ${runId} | Mode: Preview | ${timestamp}`,
    '',
    '## Preview Items',
    '',
    '| # | Action | Story ID | Summary | Type | Priority |',
    '|---|--------|----------|---------|------|----------|',
  ];

  for (const pi of previewItems) {
    lines.push(`| ${pi.index} | ${pi.action} | ${pi.storyId} | ${pi.summary} | ${pi.type} | ${pi.priority} |`);
  }

  lines.push('');
  lines.push('## Status');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| To create | ${previewItems.length} |`);
  lines.push(`| Skipped (status) | ${skippedEntries.length} |`);
  lines.push(`| Validation failures | ${validationErrors.length} |`);
  lines.push('');
  lines.push('To execute registration, run:');
  lines.push('');
  lines.push('```');
  lines.push(`node apply.mjs --draft "${draftPath}" --confirm${dryRun ? ' --dry-run' : ''}`);
  lines.push('```');

  const outDir = dirname(outFile);
  if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, lines.join('\n'), 'utf-8');
  log(`Preview report written: ${outFile}`);
}

main();
