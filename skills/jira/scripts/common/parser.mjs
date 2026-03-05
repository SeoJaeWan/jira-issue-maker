/**
 * Parses a user story Markdown file into structured objects.
 * Splits by ## headings, extracts field tables, validates required fields.
 */
import { readFileSync, existsSync } from 'node:fs';

/**
 * @param {object} opts
 * @param {string} opts.inputPath
 * @param {string[]} opts.requiredFields
 * @param {string[]} opts.allowedLabels
 * @param {string} opts.storyIdPrefix
 * @returns {{ stories: object[], warnings: string[], errors: string[] }}
 */
export function parseStories(opts) {
  const {
    inputPath,
    requiredFields = ['summary', 'description', 'issuetype', 'labels', 'story_id', 'priority'],
    allowedLabels = [],
    storyIdPrefix = 'STORY',
  } = opts;

  const stories = [];
  const warnings = [];
  const errors = [];

  if (!existsSync(inputPath)) {
    errors.push(`Input file not found: ${inputPath}`);
    return { stories, warnings, errors };
  }

  const lines = readFileSync(inputPath, 'utf-8').split(/\r?\n/);

  // Split into story blocks by ## headings
  const storyBlocks = [];
  let currentBlock = null;
  let storyIndex = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      if (currentBlock) storyBlocks.push(currentBlock);
      currentBlock = { heading: headingMatch[1].trim(), lines: [], index: storyIndex++ };
    } else if (currentBlock) {
      currentBlock.lines.push(line);
    }
  }
  if (currentBlock) storyBlocks.push(currentBlock);

  if (storyBlocks.length === 0) {
    warnings.push('No story sections (## heading) found in input file.');
  }

  // Parse each block
  let autoIdCounter = 1;
  const validPriorities = ['High', 'Medium', 'Low'];

  for (const block of storyBlocks) {
    const story = {
      summary: '',
      description: '',
      issuetype: '',
      labels: '',
      story_id: '',
      priority: '',
      raw_heading: block.heading,
      parse_warnings: [],
    };

    // Extract summary from heading
    let headingSummary = block.heading;
    const storyPrefixMatch = headingSummary.match(/^(?:Story|User Story)\s*(?::|：)\s*(.+)$/);
    if (storyPrefixMatch) headingSummary = storyPrefixMatch[1].trim();
    story.summary = headingSummary;

    // Extract description
    const descriptionLines = [];
    let inDescription = false;
    let inMetadata = false;

    for (const bline of block.lines) {
      const trimmed = bline.trim();

      if (/^\|.+\|$/.test(trimmed)) {
        inMetadata = true; inDescription = false;
        continue;
      }
      if (/^###\s*(Description|설명|내용)/.test(trimmed)) {
        inDescription = true; inMetadata = false;
        continue;
      }
      if (/^###\s+/.test(trimmed)) {
        inDescription = false; inMetadata = false;
        continue;
      }

      if (inDescription) {
        descriptionLines.push(bline);
      } else if (!inMetadata && trimmed.length > 0 && trimmed !== '---') {
        descriptionLines.push(bline);
      }
    }
    story.description = descriptionLines.join('\n').trim();

    // Extract key-value metadata from table rows or key: value lines
    const fieldMap = {};
    for (const bline of block.lines) {
      const trimmed = bline.trim();

      const tableMatch = trimmed.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|$/);
      if (tableMatch) {
        const fKey = tableMatch[1].trim().toLowerCase();
        const fVal = tableMatch[2].trim();
        if (!/^[-]+$/.test(fKey) && fKey !== 'field' && !/^[-]+$/.test(fVal)) {
          fieldMap[fKey] = fVal;
        }
      }

      const kvMatch = trimmed.match(/^(labels|priority|story_id|issuetype|issue.?type)\s*(?::|：)\s*(.+)$/);
      if (kvMatch) {
        const fKey = kvMatch[1].trim().toLowerCase().replace(/issue.?type/, 'issuetype');
        const fVal = kvMatch[2].trim();
        if (!(fKey in fieldMap)) fieldMap[fKey] = fVal;
      }
    }

    // Apply extracted fields
    for (const key of ['summary', 'description', 'issuetype', 'labels', 'story_id', 'priority']) {
      if (fieldMap[key] && fieldMap[key].length > 0) {
        story[key] = fieldMap[key];
      }
    }

    // Auto-fill missing story_id
    if (!story.story_id || !story.story_id.trim()) {
      story.story_id = `${storyIdPrefix}-${String(autoIdCounter).padStart(3, '0')}`;
      story.parse_warnings.push(`story_id auto-generated: ${story.story_id}`);
      autoIdCounter++;
    }

    // Validate required fields
    for (const rf of requiredFields) {
      if (!story[rf] || !String(story[rf]).trim()) {
        story.parse_warnings.push(`Required field missing or empty: ${rf}`);
      }
    }

    // Validate labels
    if (allowedLabels.length > 0 && story.labels && story.labels.trim()) {
      const storyLabels = story.labels.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
      for (const lbl of storyLabels) {
        if (!allowedLabels.includes(lbl)) {
          story.parse_warnings.push(`Label not in allowed list: ${lbl}`);
        }
      }
    }

    // Validate priority
    if (story.priority && story.priority.trim() && !validPriorities.includes(story.priority)) {
      story.parse_warnings.push(`Invalid priority value: ${story.priority}. Expected: High, Medium, or Low.`);
    }

    // Collect warnings
    for (const pw of story.parse_warnings) {
      warnings.push(`[Story #${block.index + 1} '${story.summary}'] ${pw}`);
    }

    stories.push(story);
  }

  return { stories, warnings, errors };
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('parser.mjs')) {
  const args = process.argv.slice(2);
  const inputPath = args[0];
  if (!inputPath) {
    console.error('Usage: node parser.mjs <input-md-path>');
    process.exit(1);
  }
  const result = parseStories({ inputPath });
  console.log(JSON.stringify(result, null, 2));
}
