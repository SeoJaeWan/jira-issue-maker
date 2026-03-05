#!/usr/bin/env node
/**
 * Phase A: Prepare a Jira review Markdown from user story input.
 *
 * Usage:
 *   node prepare.mjs --input <md> --project-key <KEY> [--epic-mode none|select|create]
 *     [--epic-key <KEY>] [--duplicate-policy ask|update|skip|create_new]
 *     --out <path> [--dry-run]
 */
import {writeFileSync, existsSync, mkdirSync} from "node:fs";
import {join, dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {parseStories} from "./common/parser.mjs";
import {inferIssueType} from "./common/infer-issue-type.mjs";
import {readSimpleYaml, mergeRules} from "./common/yaml-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const skillRoot = dirname(__dirname);

// ── Parse CLI args ──────────────────────────────────────────────
function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        switch (argv[i]) {
            case "--input":
            case "-Input":
                args.inputFile = argv[++i];
                break;
            case "--project-key":
            case "-ProjectKey":
                args.projectKey = argv[++i];
                break;
            case "--epic-mode":
            case "-EpicMode":
                args.epicMode = argv[++i];
                break;
            case "--epic-key":
            case "-EpicKey":
                args.epicKey = argv[++i];
                break;
            case "--duplicate-policy":
            case "-DuplicatePolicy":
                args.duplicatePolicy = argv[++i];
                break;
            case "--out":
            case "-Out":
                args.outFile = argv[++i];
                break;
            case "--dry-run":
            case "-DryRun":
                args.dryRun = true;
                break;
        }
    }
    return args;
}

function log(msg, level = "INFO") {
    console.log(`[${level}] ${msg}`);
}

function main() {
    const args = parseArgs(process.argv);
    const {inputFile, projectKey, epicMode = "none", epicKey = "", duplicatePolicy = "ask", outFile, dryRun = false} = args;

    if (!inputFile || !projectKey || !outFile) {
        console.error("Usage: node prepare.mjs --input <md> --project-key <KEY> --out <path>");
        process.exit(1);
    }

    log("=== Jira MD Review Prepare Pipeline ===");
    log(`Input: ${inputFile}`);
    log(`ProjectKey: ${projectKey}`);
    log(`EpicMode: ${epicMode}`);
    log(`DuplicatePolicy: ${duplicatePolicy}`);
    log(`Output: ${outFile}`);
    if (dryRun) log("DryRun mode enabled -- no Jira queries will be made.", "WARN");

    // ── Step 1: Load project rules ─────────────────────────────────
    log("Step 1: Loading project rules...");
    const baseRules = readSimpleYaml(join(skillRoot, "projects/_base.yaml"));
    const projectRules = readSimpleYaml(join(skillRoot, `projects/${projectKey}.yaml`));
    const rules = mergeRules(baseRules, projectRules);

    const requiredFields =
        Array.isArray(rules.required_fields) && rules.required_fields.length > 0
            ? rules.required_fields
            : ["summary", "description", "issuetype", "labels", "story_id", "priority"];

    const allowedLabels = Array.isArray(rules.allowed_labels) && rules.allowed_labels.length > 0 ? rules.allowed_labels : [];

    const storyIdPrefix = rules.story_id_default_prefix || "STORY";
    const defaultType = rules.default_issuetype || "Story";
    const defaultPriority = rules.default_priority || "Medium";

    log(`Rules loaded. Required fields: ${requiredFields.join(", ")}`);

    // ── Step 2: Parse user stories ─────────────────────────────────
    log(`Step 2: Parsing user stories from ${inputFile} ...`);
    const parseResult = parseStories({
        inputPath: inputFile,
        requiredFields,
        allowedLabels,
        storyIdPrefix
    });

    if (parseResult.errors.length > 0) {
        for (const err of parseResult.errors) log(err, "ERROR");
        console.error(`Parsing failed with ${parseResult.errors.length} error(s). Aborting.`);
        process.exit(1);
    }

    const parsedStories = parseResult.stories;
    log(`Parsed ${parsedStories.length} story/stories.`);

    const allWarnings = [...parseResult.warnings];
    if (allWarnings.length > 0) {
        log(`${allWarnings.length} warning(s) during parsing:`, "WARN");
        for (const w of allWarnings) log(`  - ${w}`, "WARN");
    }

    // ── Step 3: Infer issue types ──────────────────────────────────
    log("Step 3: Inferring issue types...");
    for (const story of parsedStories) {
        const inferResult = inferIssueType({
            summary: story.summary,
            description: story.description,
            defaultType
        });

        if (!story.issuetype || !story.issuetype.trim()) {
            story.issuetype = inferResult.issueType;
            allWarnings.push(
                `[Story '${story.summary}'] Issue type inferred: ${inferResult.issueType} (confidence: ${inferResult.confidence}, reason: ${inferResult.reason})`
            );
        } else if (story.issuetype !== inferResult.issueType) {
            allWarnings.push(
                `[Story '${story.summary}'] Explicit issuetype '${story.issuetype}' kept; inference would have chosen '${inferResult.issueType}' (${inferResult.reason})`
            );
        }

        if (!story.priority || !story.priority.trim()) {
            story.priority = defaultPriority;
            allWarnings.push(`[Story '${story.summary}'] Priority defaulted to: ${defaultPriority}`);
        }
    }

    // ── Step 4: Apply project context ──────────────────────────────
    log("Step 4: Applying project context...");
    let resolvedEpicKey = "";
    switch (epicMode) {
        case "none":
            break;
        case "select":
            if (!epicKey || !epicKey.trim()) {
                if (rules.default_epic && rules.default_epic.length > 0) {
                    resolvedEpicKey = rules.default_epic;
                    log(`Using default epic from project rules: ${resolvedEpicKey}`);
                } else {
                    log("EpicMode is 'select' but no EpicKey provided and no default_epic in rules.", "WARN");
                    allWarnings.push("EpicMode is 'select' but EpicKey was not provided. Epic field left empty.");
                }
            } else {
                resolvedEpicKey = epicKey;
            }
            break;
        case "create":
            resolvedEpicKey = "(new-epic-pending)";
            allWarnings.push("EpicMode is 'create': a new epic will be created during apply phase.");
            break;
    }

    const schemaDupPolicy = {ask: "warn", update: "warn", skip: "skip", create_new: "warn"}[duplicatePolicy] || "warn";

    log(`Epic key: ${resolvedEpicKey || "(none)"}`);
    log(`Duplicate policy (schema): ${schemaDupPolicy}`);

    // ── Step 5: Generate review Markdown ───────────────────────────
    log("Step 5: Generating review Markdown...");
    const timestamp = new Date().toISOString();
    const lines = [];

    // YAML front matter
    lines.push("---");
    lines.push(`project_key: "${projectKey}"`);
    lines.push(`epic_key: "${resolvedEpicKey}"`);
    lines.push(`duplicate_policy: "${schemaDupPolicy}"`);
    lines.push(`generated_at: "${timestamp}"`);
    lines.push("---");
    lines.push("");
    lines.push(`# Jira Review: ${projectKey}`);
    lines.push("");
    lines.push(`> Epic: ${resolvedEpicKey || "(none)"} | Duplicate Policy: ${schemaDupPolicy} | Generated: ${timestamp}`);
    lines.push("");

    for (const story of parsedStories) {
        let summaryShort = story.summary;
        if (summaryShort.length > 60) summaryShort = summaryShort.substring(0, 57) + "...";

        lines.push(`## Story: ${summaryShort}`);
        lines.push("");
        lines.push("| Field | Value |");
        lines.push("|-------|-------|");
        lines.push(`| summary | ${story.summary} |`);
        lines.push(`| description | ${story.description.replace(/\r?\n/g, "<br>")} |`);
        lines.push(`| issuetype | ${story.issuetype} |`);
        lines.push(`| labels | ${story.labels} |`);
        lines.push(`| story_id | ${story.story_id} |`);
        lines.push(`| priority | ${story.priority} |`);
        lines.push("| status | pending |");
        lines.push("| jira_key | |");
        lines.push("| error | |");
        lines.push("");
    }

    if (allWarnings.length > 0) {
        lines.push("<!-- WARNINGS:");
        for (const w of allWarnings) lines.push(`  - ${w}`);
        lines.push("-->");
        lines.push("");
    }

    lines.push("<!-- CHANGE_HISTORY:");
    lines.push(`  - ${timestamp} : Initial draft generated by prepare pipeline.`);
    lines.push(`    Stories: ${parsedStories.length}, Warnings: ${allWarnings.length}`);
    lines.push(`    Parameters: ProjectKey=${projectKey}, EpicMode=${epicMode}, DuplicatePolicy=${duplicatePolicy}`);
    if (dryRun) lines.push("    Mode: DryRun (no Jira queries)");
    lines.push("-->");

    // Write output
    const outDir = dirname(outFile);
    if (outDir && !existsSync(outDir)) mkdirSync(outDir, {recursive: true});
    writeFileSync(outFile, lines.join("\n"), "utf-8");
    log(`Review file written: ${outFile}`);

    // Summary
    log("");
    log("=== Prepare Pipeline Summary ===");
    log(`  Stories parsed:   ${parsedStories.length}`);
    log(`  Warnings:         ${allWarnings.length}`);
    log(`  Errors:           0`);
    log(`  Output file:      ${outFile}`);
    log(`  Status:           All entries set to 'pending'`);
    log("");
    log("Next step: Review the generated file, change status to 'approved' or 'rejected', then run the apply phase.");
}

main();
