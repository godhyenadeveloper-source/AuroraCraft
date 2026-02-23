/**
 * AuroraCraft AI Thinking System
 *
 * Defines 8 thinking types with multiple levels each.
 * Every AI operation is classified into one thinking type at one level.
 * The classification drives prompt depth instructions that guide the AI's
 * reasoning depth, and the resulting thinking is displayed in a collapsible block.
 */

// ─── Types ──────────────────────────────────────────────────────────────

export interface ThinkingLevel {
  level: number;
  name: string;
  depthInstruction: string;
}

export interface ThinkingTypeDef {
  id: string;
  name: string;
  levels: ThinkingLevel[];
}

/** Result of classifying an operation — used to inject into prompts and display in UI. */
export interface ThinkingContext {
  typeId: string;
  typeName: string;
  level: number;
  levelName: string;
  content: string | null;
}

// ─── Thinking Type Definitions ──────────────────────────────────────────

export const THINKING_TYPES: Record<string, ThinkingTypeDef> = {
  question: {
    id: "question",
    name: "Question Think",
    levels: [
      {
        level: 1,
        name: "Fast Think",
        depthInstruction:
          "This is a simple question or greeting. Think briefly — identify what is being asked, confirm you have a direct answer, and respond. Keep your reasoning to 1-2 sentences.",
      },
      {
        level: 2,
        name: "Mid Think",
        depthInstruction:
          "This is a complex question requiring comparison, multi-part reasoning, or conceptual understanding. Structure your thinking: identify each part of the question, consider relevant knowledge, reason through relationships or trade-offs, then compose a clear answer. Use 3-5 sentences of reasoning.",
      },
    ],
  },

  "context-gathering": {
    id: "context-gathering",
    name: "Context Gathering Think",
    levels: [
      {
        level: 1,
        name: "Single File Read",
        depthInstruction:
          "You are reading one file. Identify the file's purpose, map its structure — package, imports, class name, fields, methods, dependencies — and summarize how it relates to the current task. Keep analysis focused and concise.",
      },
      {
        level: 2,
        name: "Multi File Read",
        depthInstruction:
          "You are reading and cross-referencing multiple files. For each file, understand its structure, then reason about how the files relate to each other — shared interfaces, dependency chains, method calls between classes. Produce a unified mental model of this codebase section.",
      },
    ],
  },

  "plan-building": {
    id: "plan-building",
    name: "Plan Building Think",
    levels: [
      {
        level: 1,
        name: "Simple Plan",
        depthInstruction:
          "This is a straightforward plugin with a clear scope. Identify the plugin's purpose, list required features, group them into logical phases, determine files per phase, and confirm correct dependency order — foundation before features before commands.",
      },
      {
        level: 2,
        name: "Complex Plan",
        depthInstruction:
          "This is a complex plugin with multiple features and cross-cutting concerns. Map out all required features, identify shared utility classes that multiple features depend on, determine correct phase ordering to avoid forward dependencies, ensure no file is planned before the classes it imports, validate total file count and phase structure. Be thorough — missed dependencies cause build failures.",
      },
    ],
  },

  "plugin-building": {
    id: "plugin-building",
    name: "Plugin Building Think",
    levels: [
      {
        level: 1,
        name: "Simple File",
        depthInstruction:
          "This is a straightforward file — a config, data class, metadata, or simple structure. Identify its purpose, determine package and imports, lay out fields or structure, and generate clean complete content. Minimal reasoning needed.",
      },
      {
        level: 2,
        name: "Standard File",
        depthInstruction:
          "This is a moderately complex file — a manager, utility, or command handler with standard logic. Read the relevant context from previously created files, identify all imports needed, map out the class structure, reason through method implementations, check for correct API usage, then generate complete working code.",
      },
      {
        level: 3,
        name: "Complex File",
        depthInstruction:
          "This is a central architecture file with async logic, shared mutable state, non-trivial algorithms, or heavy dependencies. Read ALL relevant context, map the full dependency graph, reason through the implementation carefully including edge cases and error handling, verify all API calls are correct and non-deprecated, ensure async/sync boundaries are respected, then generate production-quality code.",
      },
    ],
  },

  "feature-refactor": {
    id: "feature-refactor",
    name: "Feature Refactor Think",
    levels: [
      {
        level: 1,
        name: "Isolated Refactor",
        depthInstruction:
          "This change affects only one or two files and does not change shared infrastructure. Read the relevant files, understand the current implementation, determine exactly what needs to change, verify the change does not break existing behavior, then produce a precise surgical update.",
      },
      {
        level: 2,
        name: "Cross-Cutting Refactor",
        depthInstruction:
          "This change spans multiple files, introduces new shared classes, modifies a manager that others depend on, or changes data structures flowing through the codebase. Read all affected files, map every location where the change must be applied, reason through ripple effects, determine the correct order of changes to avoid breaking intermediate states, then produce precise updates for every affected file.",
      },
    ],
  },

  "error-debugging": {
    id: "error-debugging",
    name: "Error Debugging Think",
    levels: [
      {
        level: 1,
        name: "Surface Error",
        depthInstruction:
          "This is an obvious error with a clear single cause — missing import, wrong method name, typo, missing return. Read the error, identify the exact line and file, determine the fix, and apply it. Brief reasoning only.",
      },
      {
        level: 2,
        name: "Logic Error",
        depthInstruction:
          "This error is not obvious from a single line — a logic bug, incorrect API usage, wrong async boundary, or a deeper cause than the stack trace shows. Read the affected file fully, trace the execution path leading to the error, identify where logic breaks down, reason through correct behavior, then apply the fix.",
      },
      {
        level: 3,
        name: "Systemic Error",
        depthInstruction:
          "This error spans multiple files or involves race conditions, incorrect component interactions, or multi-location causes. Read all relevant files, reconstruct the full execution flow from entry point through every layer, identify every contributing location, determine the correct fix at each point, then apply surgical patches across all affected files in the right order.",
      },
    ],
  },

  "plugin-polish": {
    id: "plugin-polish",
    name: "Plugin Polish Think",
    levels: [
      {
        level: 1,
        name: "Quick Polish",
        depthInstruction:
          "Review a small set of files for: missing permission nodes in plugin.yml, missing messages in config, undeclared commands, inconsistent message formatting, hardcoded strings that should be configurable, missing null safety on player lookups, incomplete command usage messages. Flag every issue found.",
      },
      {
        level: 2,
        name: "Deep Polish",
        depthInstruction:
          "Comprehensive review across many files. Check all Quick Polish items plus: command aliases not declared, permission inheritance not configured, config values not validated on load, inconsistent colour schemes, cooldowns not applying everywhere, edge cases in teleportation/world validation, and any planned feature that is missing or incomplete in the implementation. Be exhaustive.",
      },
    ],
  },

  "plugin-optimize": {
    id: "plugin-optimize",
    name: "Plugin Optimize Think",
    levels: [
      {
        level: 1,
        name: "Targeted Optimization",
        depthInstruction:
          "A specific area is known to be inefficient. Identify the exact inefficiency — unnecessary object creation, synchronous ops that should be async, linear search that should use a map, scheduled task running too often — and determine the optimised implementation. Change only the affected code.",
      },
      {
        level: 2,
        name: "Full Optimization",
        depthInstruction:
          "Comprehensive optimization pass. Identify all performance concerns: repeated config reads that should be cached, world operations on the main thread, suboptimal collection types, event listeners that could be more specific, excessive state in memory. Apply targeted patches at each location while preserving architecture and working logic.",
      },
    ],
  },
};

// ─── Classification Logic ───────────────────────────────────────────────

export type OperationStage =
  | "planning"
  | "file-read"
  | "file-generation"
  | "file-patch"
  | "review"
  | "agentic-step"
  | "conversation"
  | "error-fix"
  | "optimization"
  | "summary";

export interface ClassificationHints {
  /** Total number of files involved or present in the project */
  fileCount?: number;
  /** Number of phases in the build plan */
  phaseCount?: number;
  /** The file path being operated on */
  filePath?: string;
  /** The user's request text */
  userRequest?: string;
  /** Number of files affected by this change */
  affectedFileCount?: number;
  /** How many fixes are needed (for error debugging) */
  fixCount?: number;
  /** Whether this is a multi-file error */
  isMultiFileError?: boolean;
}

/** Central file patterns that indicate complex architecture files */
const COMPLEX_FILE_PATTERNS = [
  /Main\.java$/i,
  /Plugin\.java$/i,
  /Manager\.java$/i,
  /Handler\.java$/i,
  /Service\.java$/i,
  /Scheduler\.java$/i,
  /Database\.java$/i,
  /API\.java$/i,
];

/** Simple file patterns — configs, metadata, data classes */
const SIMPLE_FILE_PATTERNS = [
  /plugin\.yml$/i,
  /pom\.xml$/i,
  /config\.yml$/i,
  /\.properties$/i,
  /Constants\.java$/i,
  /Permissions\.java$/i,
];

/** Greeting / simple question patterns */
const SIMPLE_QUESTION_PATTERNS = [
  /^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening)|what'?s?\s+up|sup)\b/i,
  /^(thanks|thank\s+you|thx|ty)\b/i,
  /^(yes|no|ok|okay|sure|got\s+it)\b/i,
];

/**
 * Classify an operation into a thinking type and level.
 * This is deterministic logic — no AI involved.
 */
export function classifyThinkingType(
  stage: OperationStage,
  hints: ClassificationHints = {},
): { typeId: string; level: number } {
  switch (stage) {
    case "planning": {
      // Complex if many phases or user request is long/detailed
      const reqLen = hints.userRequest?.length || 0;
      const isComplex = (hints.phaseCount && hints.phaseCount >= 3) || reqLen > 300;
      return { typeId: "plan-building", level: isComplex ? 2 : 1 };
    }

    case "file-read": {
      return {
        typeId: "context-gathering",
        level: (hints.fileCount && hints.fileCount > 1) ? 2 : 1,
      };
    }

    case "file-generation": {
      const path = hints.filePath || "";
      if (SIMPLE_FILE_PATTERNS.some((p) => p.test(path))) {
        return { typeId: "plugin-building", level: 1 };
      }
      if (COMPLEX_FILE_PATTERNS.some((p) => p.test(path))) {
        return { typeId: "plugin-building", level: 3 };
      }
      return { typeId: "plugin-building", level: 2 };
    }

    case "file-patch": {
      const affected = hints.affectedFileCount || 1;
      if (hints.isMultiFileError) {
        return { typeId: "error-debugging", level: 3 };
      }
      return {
        typeId: "feature-refactor",
        level: affected > 2 ? 2 : 1,
      };
    }

    case "review": {
      const totalFiles = hints.fileCount || 0;
      return {
        typeId: "plugin-polish",
        level: totalFiles >= 10 ? 2 : 1,
      };
    }

    case "agentic-step": {
      if (hints.isMultiFileError || (hints.fixCount && hints.fixCount > 0)) {
        return { typeId: "error-debugging", level: hints.isMultiFileError ? 2 : 1 };
      }
      const affected = hints.affectedFileCount || 1;
      return {
        typeId: "feature-refactor",
        level: affected > 2 ? 2 : 1,
      };
    }

    case "conversation": {
      const msg = hints.userRequest || "";
      const isSimple =
        msg.length < 60 ||
        SIMPLE_QUESTION_PATTERNS.some((p) => p.test(msg.trim()));
      return { typeId: "question", level: isSimple ? 1 : 2 };
    }

    case "error-fix": {
      if (hints.isMultiFileError || (hints.fixCount && hints.fixCount > 3)) {
        return { typeId: "error-debugging", level: 3 };
      }
      if (hints.fixCount && hints.fixCount > 1) {
        return { typeId: "error-debugging", level: 2 };
      }
      return { typeId: "error-debugging", level: 1 };
    }

    case "optimization": {
      return {
        typeId: "plugin-optimize",
        level: (hints.fileCount || 1) > 3 ? 2 : 1,
      };
    }

    case "summary": {
      return { typeId: "question", level: 1 };
    }

    default:
      return { typeId: "question", level: 1 };
  }
}

/**
 * Look up the full ThinkingContext metadata for a classified type + level.
 */
export function resolveThinkingContext(
  typeId: string,
  level: number,
): Omit<ThinkingContext, "content"> {
  const typeDef = THINKING_TYPES[typeId];
  if (!typeDef) {
    return { typeId, typeName: "Think", level, levelName: "Unknown" };
  }
  const levelDef = typeDef.levels.find((l) => l.level === level) || typeDef.levels[0];
  return {
    typeId: typeDef.id,
    typeName: typeDef.name,
    level: levelDef.level,
    levelName: levelDef.name,
  };
}

/**
 * Build the thinking instruction text to prepend to an AI system prompt.
 * This tells the AI what kind of thinking to do and how deep to go,
 * and requires output inside <thinking> tags.
 */
export function buildThinkingInstruction(typeId: string, level: number): string {
  const typeDef = THINKING_TYPES[typeId];
  if (!typeDef) return "";

  const levelDef = typeDef.levels.find((l) => l.level === level);
  if (!levelDef) return "";

  return `## THINKING PROTOCOL
Before producing your output, reason through your approach inside <thinking> tags.
Thinking Type: ${typeDef.name} — Level ${levelDef.level} (${levelDef.name})
Depth: ${levelDef.depthInstruction}
Your <thinking> block must demonstrate this level of analysis. After your </thinking> closing tag, produce your output exactly as specified below.

`;
}
