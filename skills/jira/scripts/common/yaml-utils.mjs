/**
 * Simple YAML parser/writer for flat key-value and simple list structures.
 * No external dependencies — handles the subset of YAML used by project rules.
 */
import { readFileSync, existsSync } from 'node:fs';

/**
 * Parse a simple YAML file into a plain object.
 * Supports: flat key: value pairs, simple lists (- item), empty [] and {}.
 * @param {string} filePath
 * @returns {Record<string, string | string[]>}
 */
export function readSimpleYaml(filePath) {
  if (!existsSync(filePath)) return {};

  const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/);
  const result = {};
  let currentKey = null;

  for (const line of lines) {
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;

    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey !== null) {
      if (!Array.isArray(result[currentKey])) {
        result[currentKey] = [];
      }
      result[currentKey].push(listMatch[1].trim().replace(/^["']|["']$/g, ''));
      continue;
    }

    const kvMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const val = kvMatch[2].trim().replace(/^["']|["']$/g, '');
      currentKey = key;

      if (val === '' || val === '[]' || val === '{}') {
        result[key] = val === '[]' ? [] : val === '{}' ? {} : '';
      } else {
        result[key] = val;
      }
    }
  }

  return result;
}

/**
 * Merge base rules with project-specific overrides.
 * @param {Record<string, any>} base
 * @param {Record<string, any>} project
 * @returns {Record<string, any>}
 */
export function mergeRules(base, project) {
  return { ...base, ...project };
}
