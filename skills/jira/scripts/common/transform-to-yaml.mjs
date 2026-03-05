/**
 * Transforms a reviewed Jira MD file into a resolved YAML structure.
 * Parses review MD, extracts approved entries, writes resolved YAML.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * @param {object} opts
 * @param {string} opts.draftPath
 * @param {string} opts.outputPath
 * @param {string[]} [opts.statusFilter=['approved']]
 * @returns {{ issues: object[], frontMatter: Record<string,string>, skipped: object[], errors: string[], outputPath: string }}
 */
export function transformToYaml(opts) {
  const { draftPath, outputPath, statusFilter = ['approved'] } = opts;

  const issues = [];
  const skipped = [];
  const errors = [];

  if (!existsSync(draftPath)) {
    errors.push(`Draft file not found: ${draftPath}`);
    return { issues, frontMatter: {}, skipped, errors, outputPath };
  }

  const lines = readFileSync(draftPath, 'utf-8').split(/\r?\n/);

  // Parse front matter
  const frontMatter = {};
  let inFrontMatter = false;
  let frontMatterDone = false;
  let contentStartIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!frontMatterDone && line.trim() === '---') {
      if (!inFrontMatter) { inFrontMatter = true; continue; }
      else { frontMatterDone = true; contentStartIdx = i + 1; continue; }
    }
    if (inFrontMatter && !frontMatterDone) {
      const m = line.match(/^\s*([^:]+):\s*(.*)$/);
      if (m) frontMatter[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }

  const projectKey = frontMatter.project_key || '';
  const epicKey = frontMatter.epic_key || '';
  const dupPolicy = frontMatter.duplicate_policy || 'warn';

  if (!projectKey) errors.push('Front matter missing required field: project_key');

  // Split into story blocks
  const storyBlocks = [];
  let currentBlock = null;

  for (let i = contentStartIdx; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^##\s+Story:\s*(.+)$/);
    if (m) {
      if (currentBlock) storyBlocks.push(currentBlock);
      currentBlock = { headingSummary: m[1].trim(), lines: [] };
    } else if (currentBlock) {
      currentBlock.lines.push(line);
    }
  }
  if (currentBlock) storyBlocks.push(currentBlock);

  // Parse each story block
  for (const block of storyBlocks) {
    const fieldMap = {};

    for (const bline of block.lines) {
      const trimmed = bline.trim();

      if (/^###\s+/.test(trimmed)) continue;

      const tableMatch = trimmed.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|$/);
      if (tableMatch) {
        const fKey = tableMatch[1].trim().toLowerCase();
        const fVal = tableMatch[2].trim();
        if (!/^[-]+$/.test(fKey) && fKey !== 'field' && !/^[-]+$/.test(fVal)) {
          fieldMap[fKey] = fVal;
        }
      }
    }

    const status = (fieldMap.status || 'pending').toLowerCase();
    if (!statusFilter.includes(status)) {
      skipped.push({
        summary: block.headingSummary,
        status,
        reason: `status is '${status}' (filter: ${statusFilter.join(', ')})`,
      });
      continue;
    }

    issues.push({
      summary: fieldMap.summary || block.headingSummary,
      description: (fieldMap.description || '').replace(/<br>/g, '\n'),
      issuetype: fieldMap.issuetype || 'Story',
      project: projectKey,
      epic_link: epicKey,
      labels: fieldMap.labels || '',
      story_id: fieldMap.story_id || '',
      priority: fieldMap.priority || 'Medium',
      custom_fields: {},
    });
  }

  // Write YAML output
  const outDir = dirname(outputPath);
  if (outDir && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const yamlLines = [
    '# Resolved issues for Jira registration',
    `# Generated from: ${draftPath}`,
    `# Generated at: ${new Date().toISOString()}`,
    '',
    `project_key: "${projectKey}"`,
    `epic_key: "${epicKey}"`,
    `duplicate_policy: "${dupPolicy}"`,
    '',
    'issues:',
  ];

  for (const issue of issues) {
    const esc = (s) => s.replace(/"/g, '\\"');
    yamlLines.push(`  - summary: "${esc(issue.summary)}"`);
    yamlLines.push(`    description: "${esc(issue.description).replace(/\n/g, '\\n')}"`);
    yamlLines.push(`    issuetype: "${issue.issuetype}"`);
    yamlLines.push(`    project: "${issue.project}"`);
    yamlLines.push(`    epic_link: "${issue.epic_link}"`);

    const labelArray = issue.labels ? issue.labels.split(/\s*,\s*/).filter(Boolean) : [];
    if (labelArray.length > 0) {
      yamlLines.push(`    labels: [${labelArray.map(l => `"${l}"`).join(', ')}]`);
    } else {
      yamlLines.push('    labels: []');
    }

    yamlLines.push(`    story_id: "${issue.story_id}"`);
    yamlLines.push(`    priority: "${issue.priority}"`);

    yamlLines.push('    custom_fields: {}');
  }

  writeFileSync(outputPath, yamlLines.join('\n') + '\n', 'utf-8');

  return { issues, frontMatter, skipped, errors, outputPath };
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('transform-to-yaml.mjs')) {
  const draftPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!draftPath || !outputPath) {
    console.error('Usage: node transform-to-yaml.mjs <draft-md-path> <output-yaml-path>');
    process.exit(1);
  }
  const result = transformToYaml({ draftPath, outputPath });
  console.log(JSON.stringify({ ...result, issues: `${result.issues.length} issues` }, null, 2));
}
