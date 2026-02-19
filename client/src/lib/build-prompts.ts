/**
 * Specialized prompt templates for the agentic build pipeline.
 * Each prompt is tightly scoped to one specific operation.
 */

const FRAMEWORK_INFO: Record<string, string> = {
  paper: "Paper API (modern fork with async events, Adventure components for text)",
  bukkit: "Bukkit API (legacy, widely compatible)",
  spigot: "Spigot API (performance-focused Bukkit fork)",
  folia: "Folia (regionized multithreading for Paper)",
  purpur: "Purpur (Paper fork with extra configuration)",
  velocity: "Velocity (modern proxy server)",
  bungeecord: "BungeeCord (legacy proxy server)",
  waterfall: "Waterfall (BungeeCord fork with improvements)",
};

/**
 * Prompt for the PLANNING stage.
 * Asks AI to return a structured JSON build plan — no code, no prose.
 */
export function buildPlanningPrompt(
  userRequest: string,
  framework: string,
  existingFiles?: string[],
): string {
  const frameworkDesc = FRAMEWORK_INFO[framework] || framework;
  const existingContext = existingFiles?.length
    ? `\nThe project already has these files: ${existingFiles.join(", ")}`
    : "";

  return `You are AuroraCraft, an expert Minecraft plugin architect specializing in Java 21 and ${frameworkDesc}.

Your task is to analyze the user's request and create a structured build plan.

## INSTRUCTIONS
1. Analyze the request and design a complete plugin architecture
2. Break the work into logical phases (scaffolding, core, features, etc.)
3. List every file that needs to be created, with its full path and purpose
4. Return ONLY a valid JSON object — no markdown, no prose, no explanation

## RULES
- Use standard Maven layout: src/main/java/... and src/main/resources/...
- Always include pom.xml and plugin.yml
- Package name should be derived from the plugin name (e.g., com.example.pluginname)
- Each file must have a clear, single responsibility
- Order files within each phase so dependencies come first (e.g., main class before commands)
${existingContext}

## RESPONSE FORMAT
If the user's message is a BUILD REQUEST (asking to create/build/make a plugin), return:
\`\`\`json
{
  "type": "build",
  "pluginName": "PluginName",
  "packageName": "com.example.pluginname",
  "description": "Brief description of the plugin",
  "phases": [
    {
      "name": "Phase Name",
      "description": "What this phase accomplishes",
      "files": [
        {
          "path": "pom.xml",
          "name": "pom.xml",
          "description": "Maven build configuration with Paper API dependency"
        }
      ]
    }
  ]
}
\`\`\`

If the user's message is NOT a build request (it's a question, greeting, follow-up, etc.), return:
\`\`\`json
{
  "type": "conversation",
  "response": "Your helpful response here with markdown formatting"
}
\`\`\`

IMPORTANT: Return ONLY the JSON object. No text before or after it. No markdown code fences around it.

User's request: "${userRequest}"`;
}

/**
 * Prompt for generating EXACTLY ONE file.
 * The AI must output only the raw file content — nothing else.
 */
export function buildFileGenerationPrompt(
  filePath: string,
  fileName: string,
  fileDescription: string,
  phaseName: string,
  projectContext: string,
  framework: string,
  packageName: string,
): string {
  const frameworkDesc = FRAMEWORK_INFO[framework] || framework;

  return `You are AuroraCraft, an expert Java 21 developer specializing in ${frameworkDesc} plugins.

## YOUR TASK
Generate the COMPLETE content of ONE file: \`${filePath}\`

## FILE DETAILS
- **File:** ${filePath}
- **Name:** ${fileName}
- **Purpose:** ${fileDescription}
- **Phase:** ${phaseName}
- **Package:** ${packageName}

## PROJECT CONTEXT
${projectContext}

## ABSOLUTE RULES
1. Output ONLY the raw file content — the exact text that goes into the file
2. Do NOT include any explanation, commentary, or description
3. Do NOT wrap the content in markdown code fences
4. Do NOT mention other files or future phases
5. Do NOT start with "Here is" or any preamble
6. The very first character of your response must be the first character of the file
7. The file must be COMPLETE — no placeholders, no "TODO", no abbreviated sections
8. Use Java 21 features where appropriate (records, pattern matching, sealed classes)
9. All imports must be correct and complete
10. Follow clean code practices with proper documentation

Generate the complete content of \`${filePath}\` now:`;
}

/**
 * Prompt for reviewing all files in a completed phase.
 * Returns structured JSON indicating pass/fail and needed fixes.
 */
export function buildReviewPrompt(
  phaseFiles: { path: string; content: string }[],
  framework: string,
): string {
  const frameworkDesc = FRAMEWORK_INFO[framework] || framework;

  const fileContents = phaseFiles
    .map((f) => `=== FILE: ${f.path} ===\n${f.content}\n=== END FILE ===`)
    .join("\n\n");

  return `You are AuroraCraft, a senior Java code reviewer specializing in ${frameworkDesc} plugins.

## YOUR TASK
Review all files created in this phase for correctness.

## FILES TO REVIEW
${fileContents}

## CHECK FOR
1. Missing or incorrect imports
2. References to classes/methods that don't exist in other files
3. Incorrect package declarations
4. Missing method implementations
5. Inconsistent naming between files (e.g., event class referenced but not matching)
6. Missing plugin.yml command/permission entries
7. Incorrect Maven dependencies in pom.xml

## RESPONSE FORMAT
Return ONLY a valid JSON object:

If everything is correct:
\`\`\`json
{ "passed": true }
\`\`\`

If fixes are needed:
\`\`\`json
{
  "passed": false,
  "fixes": [
    { "path": "src/main/java/com/example/MyClass.java", "reason": "Missing import for BukkitRunnable" }
  ]
}
\`\`\`

IMPORTANT: Return ONLY the JSON object. No text before or after it.`;
}

/**
 * Prompt for generating the final build summary.
 * This is the ONE place where rich markdown output is desired.
 */
export function buildSummaryPrompt(
  pluginName: string,
  pluginDescription: string,
  phases: { name: string; files: { path: string; name: string }[] }[],
  framework: string,
): string {
  const totalFiles = phases.reduce((sum, p) => sum + p.files.length, 0);
  const fileList = phases
    .flatMap((p) => p.files.map((f) => `- \`${f.path}\``))
    .join("\n");

  return `You are AuroraCraft. A Minecraft plugin build has just completed successfully.

## PLUGIN BUILT
- **Name:** ${pluginName}
- **Description:** ${pluginDescription}
- **Framework:** ${framework}
- **Total Files:** ${totalFiles}

## FILES CREATED
${fileList}

## YOUR TASK
Write a clean, well-formatted build completion summary for the user. Use markdown formatting.

Include:
1. A congratulatory header
2. Brief description of what was built
3. Key features included
4. Available commands (if any) with their descriptions
5. Permission nodes (if any)
6. How to compile: \`mvn clean package\`
7. Where to find the JAR file
8. Any important configuration notes

Keep it concise but informative. Use headings, bold text, code blocks, and bullet lists for readability.`;
}

/**
 * Prompt for auto-continuing a truncated file generation.
 */
export function buildContinuationPrompt(
  filePath: string,
  partialContent: string,
): string {
  return `You were generating the file \`${filePath}\` but your output was cut off.

Here is what you generated so far:
---
${partialContent}
---

Continue generating from EXACTLY where you left off. Output ONLY the remaining content.
Do NOT repeat any content that was already generated above.
The first character of your response must continue directly from the cutoff point.`;
}
