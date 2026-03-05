/**
 * Infers the Jira issue type from story text content.
 * Keyword-based scoring: Bug, Task, or default (Story).
 * Bilingual (EN/KR) keyword dictionaries with weighted patterns.
 */

const bugKeywords = [
  { pattern: /\b(bug|bugs)\b/i,          weight: 3 },
  { pattern: /\b(defect|defects)\b/i,    weight: 3 },
  { pattern: /버그/,                      weight: 3 },
  { pattern: /결함/,                      weight: 3 },
  { pattern: /오류/,                      weight: 2 },
  { pattern: /에러/,                      weight: 2 },
  { pattern: /\b(error|errors)\b/i,      weight: 2 },
  { pattern: /\b(fix|fixes|fixed)\b/i,   weight: 1 },
  { pattern: /수정/,                      weight: 1 },
  { pattern: /\b(hotfix)\b/i,            weight: 3 },
  { pattern: /\b(regression)\b/i,        weight: 3 },
  { pattern: /\b(crash|crashes)\b/i,     weight: 2 },
  { pattern: /\b(broken)\b/i,           weight: 2 },
];

const taskKeywords = [
  { pattern: /\b(technical debt)\b/i,    weight: 3 },
  { pattern: /\b(tech debt)\b/i,        weight: 3 },
  { pattern: /기술적 작업/,              weight: 3 },
  { pattern: /기술 작업/,                weight: 3 },
  { pattern: /인프라/,                    weight: 3 },
  { pattern: /\b(infrastructure)\b/i,    weight: 3 },
  { pattern: /\b(infra)\b/i,            weight: 2 },
  { pattern: /\b(devops)\b/i,           weight: 3 },
  { pattern: /\b(ci\/cd|cicd)\b/i,      weight: 3 },
  { pattern: /\b(migration)\b/i,        weight: 2 },
  { pattern: /마이그레이션/,              weight: 2 },
  { pattern: /\b(refactor|refactoring)\b/i, weight: 2 },
  { pattern: /리팩토링|리팩터링/,          weight: 2 },
  { pattern: /\b(setup|configuration)\b/i, weight: 1 },
  { pattern: /설정|구성/,                 weight: 1 },
  { pattern: /\b(deployment)\b/i,        weight: 2 },
  { pattern: /배포/,                      weight: 2 },
  { pattern: /\b(monitoring)\b/i,        weight: 2 },
  { pattern: /모니터링/,                  weight: 2 },
  { pattern: /\b(chore)\b/i,            weight: 2 },
];

function getTypeScore(text, keywords) {
  let score = 0;
  const matchedPatterns = [];
  for (const kw of keywords) {
    if (kw.pattern.test(text)) {
      score += kw.weight;
      matchedPatterns.push(kw.pattern.source.replace(/\\b|\(|\)/g, ''));
    }
  }
  return { score, matchedPatterns };
}

function getConfidence(score) {
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

/**
 * @param {object} opts
 * @param {string} opts.summary
 * @param {string} [opts.description='']
 * @param {string} [opts.defaultType='Story']
 * @returns {{ issueType: string, confidence: string, reason: string }}
 */
export function inferIssueType({ summary, description = '', defaultType = 'Story' }) {
  const combinedText = `${summary} ${description}`;
  const bugResult = getTypeScore(combinedText, bugKeywords);
  const taskResult = getTypeScore(combinedText, taskKeywords);

  let issueType = defaultType;
  let confidence = 'high';
  let reason = `No exception keywords detected; defaulting to ${defaultType}.`;

  if (bugResult.score > 0 || taskResult.score > 0) {
    if (bugResult.score > taskResult.score) {
      issueType = 'Bug';
      confidence = getConfidence(bugResult.score);
      reason = `Bug keywords detected: ${bugResult.matchedPatterns.join(', ')} (score: ${bugResult.score})`;
    } else if (taskResult.score > bugResult.score) {
      issueType = 'Task';
      confidence = getConfidence(taskResult.score);
      reason = `Task keywords detected: ${taskResult.matchedPatterns.join(', ')} (score: ${taskResult.score})`;
    } else {
      confidence = 'low';
      reason = `Both Bug and Task keywords detected with equal score (${bugResult.score}). Defaulting to ${defaultType}.`;
    }
  }

  return { issueType, confidence, reason };
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('infer-issue-type.mjs')) {
  const summary = process.argv[2] || '';
  const description = process.argv[3] || '';
  const result = inferIssueType({ summary, description });
  console.log(JSON.stringify(result, null, 2));
}
