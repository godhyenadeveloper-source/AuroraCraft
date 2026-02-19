# AuroraCraft Agentic Build System — Implementation Plan

## Overview

This plan fixes all 10 reported issues by introducing a **client-side build orchestration engine**, **markdown rendering**, and a **lightweight server-side AI proxy endpoint**. The build engine takes complete control of the build process: one planning call, phased file creation (one file per AI call), phase reviews, auto-continuation, retry with backoff, and real-time badge/progress UI.

---

## New Dependencies (package.json)

| Package | Purpose |
|---------|---------|
| `react-markdown` | Parse and render markdown in chat messages |
| `remark-gfm` | GitHub Flavored Markdown support (tables, strikethrough, task lists) |

These are the only two new packages. We already have `@tailwindcss/typography` installed and configured (prose classes available).

---

## Files to Create (5 new files)

### 1. `client/src/lib/ai-client.ts` — Unified AI Abstraction

**Purpose:** Normalize both AI paths (Puter.js client-side and server-side) into a single async function the build engine calls.

**Key exports:**
```
generateAI(options): Promise<string>
```

**How it works:**
- Takes: `{ model, systemPrompt, messages[], sessionId, maxTokens?, signal? }`
- If `model.providerAuthType === "puterjs"` → calls `window.puter.ai.chat()` directly, iterates async stream, returns full text
- If server-side model → calls new `POST /api/ai/generate` via SSE, accumulates chunks, returns full text
- Both paths return the same thing: a plain string of the AI's full response
- Handles `AbortSignal` for cancellation
- Does NOT save messages or deduct tokens (the caller handles that)

---

### 2. `client/src/lib/build-prompts.ts` — Build Pipeline Prompt Templates

**Purpose:** Specialized prompts for each step of the agentic build pipeline. These are separate from the existing `server/prompts.ts` (which continues to serve plan/question modes).

**Key exports:**

1. **`buildPlanningPrompt(userRequest, framework, existingFiles?)`**
   - System prompt that instructs the AI to analyze the request and return a JSON build plan
   - Specifies the exact JSON schema: `{ pluginName, description, phases: [{ name, description, files: [{ path, name, description }] }] }`
   - Absolute instruction: return ONLY valid JSON, no prose, no markdown, no explanation
   - If the request is conversational (not a build request), return: `{ "type": "conversation", "response": "..." }`

2. **`buildFileGenerationPrompt(filePath, fileName, fileDescription, phaseName, projectContext, framework)`**
   - System prompt for generating exactly ONE file
   - Names the file explicitly, provides its purpose
   - Includes `projectContext` (summary of all files created so far with their content, up to 50KB)
   - Absolute instruction: output ONLY the raw file content — no explanation, no fenced code blocks, no prose, no "Here is the file" preamble
   - Includes framework-specific knowledge (Paper API, Maven structure, etc.)

3. **`buildReviewPrompt(phaseFiles: { path, content }[], framework)`**
   - System prompt for reviewing all files in the completed phase
   - Injects the actual content of every file
   - Asks AI to check: missing imports, integration errors, incorrect references, logical bugs
   - Return JSON: `{ passed: boolean, fixes: [{ path, reason }] }` or `{ passed: true }`

4. **`buildSummaryPrompt(plan, framework)`**
   - System prompt for the final build summary
   - Asks for a clean, well-formatted markdown summary: what was built, features, commands, how to compile
   - This is the ONE place where rich markdown output is expected and desired

---

### 3. `client/src/lib/build-engine.ts` — Core Orchestration Engine

**Purpose:** The state machine that controls the entire build process. This is the most critical new file.

**Types:**
```typescript
interface BuildPlan {
  pluginName: string;
  description: string;
  phases: BuildPhase[];
}
interface BuildPhase {
  name: string;
  description: string;
  files: PlannedFile[];
}
interface PlannedFile {
  path: string;
  name: string;
  description: string;
}

// Runtime state
interface BuildState {
  status: 'idle' | 'planning' | 'building' | 'reviewing' | 'complete' | 'error' | 'cancelled';
  plan: BuildPlan | null;
  currentPhaseIndex: number;
  currentFileIndex: number;
  phases: PhaseState[];
  thinkingMessage: string | null;  // e.g. "Generating pom.xml..."
  error: string | null;
}
interface PhaseState {
  name: string;
  description: string;
  status: 'pending' | 'active' | 'reviewing' | 'complete';
  files: FileState[];
}
interface FileState {
  path: string;
  name: string;
  description: string;
  status: 'pending' | 'generating' | 'created' | 'updating' | 'updated' | 'error';
  error?: string;
}

type BuildEvent =
  | { type: 'planning' }
  | { type: 'plan-ready'; plan: BuildPlan }
  | { type: 'conversation-response'; content: string }  // fallback for non-build messages
  | { type: 'phase-start'; phaseIndex: number }
  | { type: 'file-generating'; phaseIndex: number; fileIndex: number }
  | { type: 'file-created'; phaseIndex: number; fileIndex: number; path: string }
  | { type: 'file-updated'; phaseIndex: number; fileIndex: number; path: string }
  | { type: 'file-error'; phaseIndex: number; fileIndex: number; error: string }
  | { type: 'phase-reviewing'; phaseIndex: number }
  | { type: 'phase-complete'; phaseIndex: number }
  | { type: 'build-complete'; summary: string }
  | { type: 'build-error'; error: string }
  | { type: 'thinking'; message: string }
```

**Key export:**
```typescript
async function runBuild(params: {
  userRequest: string;
  sessionId: number;
  model: VisibleModel;
  framework: string;
  existingMessages: ChatMessage[];
  onEvent: (event: BuildEvent) => void;
  signal: AbortSignal;
}): Promise<void>
```

**Build pipeline (executed sequentially):**

1. **Save user message** to DB via `POST /api/sessions/:id/messages`
2. **Emit** `{ type: 'planning' }` → UI shows "Analyzing your request..."
3. **Planning call**: `generateAI()` with planning prompt
   - Parse JSON response (with retry on parse failure)
   - If response is `{ type: "conversation" }` → emit `conversation-response`, return (falls back to regular chat display)
   - Otherwise → emit `{ type: 'plan-ready', plan }` → UI shows formatted plan
   - Save plan summary as assistant message to DB
4. **Initialize file memory**: `Map<string, string>` to track all created file contents
5. **Phase loop** — for each phase in the plan:
   a. Emit `{ type: 'phase-start', phaseIndex }` → UI shows phase announcement
   b. **File creation loop** — for each file in the phase:
      - Emit `{ type: 'file-generating', phaseIndex, fileIndex }` → UI shows thinking indicator
      - Build context string from file memory (all files created so far, truncated to 50KB total)
      - Call `generateAI()` with single-file prompt
      - **Auto-continuation**: If response appears truncated (no closing brace for Java, no closing tag for XML, `finish_reason === "length"`), make follow-up call asking to continue from cutoff point, concatenate responses
      - **Retry**: On API failure, retry up to 3 times with delays (1s, 3s, 7s). On final failure, emit `file-error` and continue to next file
      - Write file via `POST /api/sessions/:id/files` (or `PATCH /api/files/:id` if updating)
      - Add to file memory
      - Emit `{ type: 'file-created', phaseIndex, fileIndex, path }` → UI shows badge
      - Report token usage via `POST /api/token-usage/apply`
   c. **Phase review**:
      - Emit `{ type: 'phase-reviewing', phaseIndex }`
      - Call `generateAI()` with review prompt (all phase file contents injected)
      - Parse JSON result
      - If fixes needed → loop through each fix (one file per call, same as creation), emit `file-updated` badges
   d. Emit `{ type: 'phase-complete', phaseIndex }` → UI shows phase done
6. **Final summary**:
   - Call `generateAI()` with summary prompt
   - Emit `{ type: 'build-complete', summary }` → UI shows rich markdown summary
   - Save summary as assistant message to DB
7. **Refresh queries**: invalidate sessions, files, messages, user (token balance)

**Error handling within the engine:**
- Every `generateAI()` call is wrapped in try/catch with 3 retries
- Between retries: exponential backoff (1000ms, 3000ms, 7000ms)
- On final failure: emit error event, but DON'T stop the entire build — skip the failed file, mark it with error badge, continue
- On catastrophic failure (planning fails, all retries exhausted on critical file): emit `build-error`, preserve all progress

**Auto-continuation logic:**
- After each AI response, check for truncation signals:
  - Response ends mid-code (unclosed braces, unclosed tags)
  - Response length is suspiciously close to max_tokens
- If truncated: make a follow-up call with prompt "Continue generating the file from exactly where you left off. Here is what you've generated so far: [partial content]. Continue from the cutoff point. Output ONLY the remaining content."
- Concatenate the continuation with the original
- Maximum 3 continuation attempts per file

---

### 4. `client/src/components/markdown-renderer.tsx` — Markdown Chat Renderer

**Purpose:** Reusable component that renders markdown content with proper styling. Used for ALL chat messages across ALL modes.

**Implementation:**
```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function MarkdownRenderer({ content, className }: { content: string; className?: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className={cn("prose prose-sm dark:prose-invert max-w-none", className)}
      components={{
        // Custom code block renderer: inline code gets bg highlight,
        // fenced code blocks get styled pre with monospace font
        code({ inline, className, children }) { ... },
        // Links open in new tab
        a({ href, children }) { ... },
        // Prevent images from being too large
        img({ src, alt }) { ... },
      }}
    />
  );
}
```

**Styling (leverages existing infrastructure):**
- `prose prose-sm` from `@tailwindcss/typography` (already installed + configured)
- `dark:prose-invert` for dark mode
- `max-w-none` to prevent prose from constraining width
- Custom overrides for code blocks: `bg-muted rounded px-1.5 py-0.5 font-mono text-sm` for inline, `bg-muted/50 rounded-lg p-4 overflow-x-auto` for blocks
- Headings get proper sizing, bold gets proper weight, lists get proper indentation

---

### 5. `client/src/components/build-messages.tsx` — Build Progress UI Components

**Purpose:** Visual components for the build process displayed in the chat area.

**Components:**

1. **`BuildPlanMessage`** — Displays the build plan in a formatted card
   - Plugin name and description
   - Phase list with file counts
   - Clean card styling with phase separators

2. **`PhaseBubble`** — Phase announcement with growing badge container
   - Header: phase name + status indicator (spinner/checkmark)
   - Badge container: flexbox wrap of FileBadge components
   - Grows as files are created (badges appear one by one)

3. **`FileBadge`** — Individual file status badge
   - States: pending (gray), generating (blue pulse), created (green), updated (yellow), error (red)
   - Shows filename with appropriate icon by extension
   - Compact pill shape, fits multiple per row

4. **`BuildThinkingIndicator`** — Animated progress indicator
   - Shows what's currently happening: "Planning your plugin...", "Generating pom.xml...", "Reviewing Phase 1..."
   - Animated dots or spinner
   - Replaces/sits below the last message during active operations

5. **`BuildSummaryMessage`** — The final summary display
   - Renders markdown via `MarkdownRenderer`
   - Optional success header with checkmark
   - Wraps in a distinct card style to stand out from regular messages

---

## Files to Modify (4 existing files)

### 6. `server/routes.ts` — Add Raw AI Generate Endpoint

**Add one new endpoint:**

```
POST /api/ai/generate (isAuthenticated)
```

**Request body:** `{ modelId, systemPrompt, messages: [{role, content}], maxTokens? }`

**Behavior:**
- Looks up model → provider → validates provider has API key
- Creates OpenAI client with provider's apiKey + baseURL
- Streams response via SSE (same format as existing `/chat/stream`: `{type:"chunk",content}` and `{type:"done",inputChars,outputChars}`)
- Does NOT save any messages to DB
- Does NOT deduct tokens
- Does NOT build system prompts (caller provides the exact prompt)
- Returns SSE events that the client `ai-client.ts` consumes

**Why needed:** The build engine makes many sequential AI calls (planning, N files, reviews, summary). Each needs different prompts and the engine manages persistence/tokens itself. The existing `/chat/stream` endpoint saves messages and deducts tokens as side effects, which would cause duplicate entries and incorrect token accounting when the build engine also does these.

**For Puter.js models:** This endpoint is not used. The build engine calls `puter.ai.chat()` directly in the browser.

---

### 7. `client/src/pages/chat.tsx` — Major Integration

**Changes by section:**

**A. Imports** — Add:
- `MarkdownRenderer` from `../components/markdown-renderer`
- `BuildPlanMessage`, `PhaseBubble`, `BuildThinkingIndicator`, `BuildSummaryMessage` from `../components/build-messages`
- `runBuild`, `BuildState`, `BuildEvent` from `../lib/build-engine`

**B. State** — Add:
- `buildState: BuildState` (useReducer for complex state)
- `isBuildActive: boolean` derived from buildState.status
- Build state reducer that handles all BuildEvent types

**C. Message rendering** — Replace the plain text renderer:

**BEFORE (line 780):**
```tsx
<p className="text-sm whitespace-pre-wrap">{msg.content}</p>
```

**AFTER:**
```tsx
<MarkdownRenderer content={msg.content} />
```

This single change fixes Issue #1 (markdown rendering) for ALL messages in ALL modes.

**D. Build message insertion** — After the regular messages list, render build-specific UI:
- If `buildState.plan` → render `<BuildPlanMessage plan={buildState.plan} />`
- For each phase in `buildState.phases` → render `<PhaseBubble phase={phase} />`
- If `buildState.thinkingMessage` → render `<BuildThinkingIndicator message={buildState.thinkingMessage} />`
- If `buildState.status === 'complete'` → render `<BuildSummaryMessage>` with markdown

**E. Send handler** — Modify `handleSend()`:
```
if (mode === "agent" && !isBuildActive) {
  → Call runBuild() with event handler that dispatches to buildState reducer
} else {
  → Existing sendMessageStreaming() (for plan/question modes and mid-build follow-ups)
}
```

**F. Streaming message rendering** — Also apply markdown to the streaming content:
```tsx
<MarkdownRenderer content={streamingContent} />
```
instead of:
```tsx
<p className="text-sm whitespace-pre-wrap">{streamingContent || ...}</p>
```

**G. Build abort** — The stop button should abort the build engine's AbortController when a build is active.

**H. No other structural changes** — File tree, code editor, compilation panel, header, dialogs all stay the same. The build engine writes files via the existing API, and the file tree auto-refreshes via query invalidation.

---

### 8. `server/prompts.ts` — Minor Adjustment

**Change:** Update the agent mode system prompt to be more concise since the build engine now controls the workflow. The existing agent prompt tells the AI to structure its own response with phases/files/summaries — this is no longer needed because the build engine handles orchestration.

However, this prompt is still used for non-build agent conversations (when the planning call returns `{ type: "conversation" }`). So we keep the prompt but remove the file generation format instructions that encouraged dumping code into chat.

**Specifically:**
- Remove the "File Generation Format" section (the `**FILE: path/to/file.java**` format)
- Remove the "Response Structure" section (Thinking → Actions → Files → Summary → Next Steps)
- Keep the base Java/Minecraft expertise
- Keep the project context injection
- Add instruction: "When the user asks a follow-up question about their existing project, provide helpful guidance. Do not generate full file contents in your response — the build system handles file creation separately."

---

### 9. `package.json` — Add Dependencies

Add to `dependencies`:
```json
"react-markdown": "^9.0.0",
"remark-gfm": "^4.0.0"
```

---

## Execution Order

The implementation should proceed in this order (dependencies flow downward):

1. **Install packages** (`react-markdown`, `remark-gfm`)
2. **Create `markdown-renderer.tsx`** — No dependencies on other new files. Test immediately by replacing chat message rendering.
3. **Update `chat.tsx` message rendering** — Replace `<p>` with `<MarkdownRenderer>`. This alone fixes Issue #1 in all modes.
4. **Create `ai-client.ts`** — Standalone utility, depends only on existing types.
5. **Add `POST /api/ai/generate`** to `server/routes.ts` — Standalone endpoint.
6. **Create `build-prompts.ts`** — Standalone prompt templates.
7. **Create `build-messages.tsx`** — UI components, depends on `markdown-renderer.tsx`.
8. **Create `build-engine.ts`** — Core engine, depends on `ai-client.ts` and `build-prompts.ts`.
9. **Integrate build engine into `chat.tsx`** — Wire up state, events, and UI components.
10. **Update `server/prompts.ts`** — Remove file dump instructions from agent mode.

---

## Issue Resolution Matrix

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| #1 Markdown not rendering | `<p>{msg.content}</p>` plain text | `<MarkdownRenderer>` component with react-markdown + prose |
| #2 Raw code in chat | AI dumps file contents into response | Build engine: file content goes to file system, never to chat |
| #3 Files not written | No file extraction/persistence logic | Build engine calls `POST /api/sessions/:id/files` for each file |
| #4 Single massive response | No orchestration, AI self-directs | Build engine: planning call → per-file calls → review calls |
| #5 Multiple files per call | No enforcement of one-file-per-call | Build engine: each `generateAI()` call has prompt scoped to ONE file |
| #6 No badge system | No build progress UI | `PhaseBubble` + `FileBadge` components with real-time state |
| #7 No phase announcements | No phase tracking | Build engine emits phase-start/phase-complete events → `PhaseBubble` UI |
| #8 No loading/thinking states | Only basic streaming indicator | `BuildThinkingIndicator` with contextual messages per operation |
| #9 No error handling | No try/catch/retry | Build engine: 3 retries with exponential backoff, error badges |
| #10 Manual continue button | Token limit hit on huge single response | Auto-continuation: detect truncation, make follow-up call, concatenate |

---

## What Is NOT Changed

- **Plan mode** — Continues using existing `sendMessageStreaming()`, just gets markdown rendering
- **Question mode** — Same as above
- **File tree component** — Unchanged, auto-refreshes via query invalidation
- **Code editor** — Unchanged
- **Compilation system** — Unchanged
- **Admin panel** — Unchanged
- **Auth system** — Unchanged
- **Database schema** — No changes needed
- **All existing API endpoints** — Unchanged (new endpoint added alongside)
- **Token accounting logic** — Unchanged (build engine reuses existing `/api/token-usage/apply`)
