import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import type { BuildPlan, PhaseState, FileState } from "@/lib/build-engine";
import {
  Loader2,
  Check,
  X,
  FileCode,
  File,
  FolderOpen,
  Blocks,
  Bot,
  RefreshCw,
  Send,
  Sparkles,
  AlertCircle,
  Eye,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Displays the build plan after planning is complete.
 */
export function BuildPlanMessage({
  plan,
  showActions,
  onConfirm,
  onCancel,
  onEdit,
}: {
  plan: BuildPlan;
  showActions?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  onEdit?: (instructions: string) => void;
}) {
  const [editText, setEditText] = useState("");
  const totalFiles = plan.phases.reduce((sum, p) => sum + p.files.length, 0);

  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
        <Bot className="w-4 h-4 text-primary-foreground" />
      </div>
      <Card className="flex-1 max-w-[85%] border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Blocks className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-semibold">
              Build Plan — {plan.pluginName}
            </CardTitle>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {plan.phases.map((phase, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-muted-foreground">{i + 1}</span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium">{phase.name}</p>
                <p className="text-[11px] text-muted-foreground">{phase.description}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {phase.files.length} file{phase.files.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          ))}
          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">
              {plan.phases.length} phases, {totalFiles} files total
            </p>
          </div>
          {showActions && onConfirm && onCancel && (
            <div className="pt-3 border-t border-border space-y-2">
              <div className="flex gap-2">
                <Button size="sm" onClick={onConfirm}>
                  <Check className="w-3 h-3 mr-1.5" /> Start Build
                </Button>
                <Button size="sm" variant="outline" onClick={onCancel}>
                  <X className="w-3 h-3 mr-1.5" /> Cancel
                </Button>
              </div>
              {onEdit && (
                <div className="flex gap-2">
                  <Input
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    placeholder="Suggest changes to the plan..."
                    className="text-xs h-8"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && editText.trim()) {
                        onEdit(editText.trim());
                        setEditText("");
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!editText.trim()}
                    onClick={() => {
                      onEdit(editText.trim());
                      setEditText("");
                    }}
                  >
                    <Send className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Phase announcement bubble with badges that grow as files are created.
 */
export function PhaseBubble({ phase, phaseIndex }: { phase: PhaseState; phaseIndex: number }) {
  const statusIcon = {
    pending: null,
    active: <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />,
    reviewing: <RefreshCw className="w-3.5 h-3.5 animate-spin text-yellow-500" />,
    complete: <Check className="w-3.5 h-3.5 text-green-500" />,
  }[phase.status];

  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
        <FolderOpen className="w-4 h-4 text-primary-foreground" />
      </div>
      <div className="max-w-[85%] space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Phase {phaseIndex + 1}
          </span>
          <span className="text-sm font-semibold">{phase.name}</span>
          {statusIcon}
        </div>
        {phase.description && (
          <p className="text-xs text-muted-foreground">{phase.description}</p>
        )}
        {phase.files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {phase.files.map((file, i) => (
              <FileBadge key={i} file={file} />
            ))}
          </div>
        )}
        {phase.status === "reviewing" && (
          <div className="flex items-center gap-1.5 mt-1">
            <RefreshCw className="w-3 h-3 animate-spin text-yellow-500" />
            <span className="text-[11px] text-yellow-500 font-medium">Reviewing phase...</span>
          </div>
        )}
        {phase.status === "complete" && (
          <div className="flex items-center gap-1.5 mt-1">
            <Check className="w-3 h-3 text-green-500" />
            <span className="text-[11px] text-green-500 font-medium">Phase complete</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Individual file status badge — compact pill showing creation/update/error state.
 */
function FileBadge({ file }: { file: FileState }) {
  const getFileIcon = (name: string) => {
    if (name.endsWith(".java")) return <FileCode className="w-3 h-3 text-orange-400" />;
    if (name.endsWith(".xml") || name.endsWith(".yml") || name.endsWith(".yaml"))
      return <FileCode className="w-3 h-3 text-yellow-400" />;
    if (name.endsWith(".json")) return <File className="w-3 h-3 text-green-400" />;
    if (name.endsWith(".md")) return <File className="w-3 h-3 text-blue-400" />;
    return <File className="w-3 h-3 text-muted-foreground" />;
  };

  const stateStyles: Record<FileState["status"], string> = {
    pending: "bg-muted text-muted-foreground border-border",
    generating: "bg-primary/10 text-primary border-primary/30 animate-pulse",
    created: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30",
    updating: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30 animate-pulse",
    updated: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
    reading: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 animate-pulse",
    read: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
    deleting: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30 animate-pulse",
    deleted: "bg-red-500/10 text-red-500/60 dark:text-red-400/60 border-red-500/20",
    error: "bg-destructive/10 text-destructive border-destructive/30",
  };

  const stateIcons: Record<FileState["status"], React.ReactNode> = {
    pending: null,
    generating: <Loader2 className="w-2.5 h-2.5 animate-spin" />,
    created: <Check className="w-2.5 h-2.5" />,
    updating: <Loader2 className="w-2.5 h-2.5 animate-spin" />,
    updated: <RefreshCw className="w-2.5 h-2.5" />,
    reading: <Eye className="w-2.5 h-2.5 animate-pulse" />,
    read: <Eye className="w-2.5 h-2.5" />,
    deleting: <Trash2 className="w-2.5 h-2.5 animate-pulse" />,
    deleted: <Trash2 className="w-2.5 h-2.5" />,
    error: <X className="w-2.5 h-2.5" />,
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium",
        stateStyles[file.status],
      )}
      title={file.error || file.description || file.path}
    >
      {getFileIcon(file.name)}
      <span className="truncate max-w-28">{file.name}</span>
      {stateIcons[file.status]}
    </div>
  );
}

/**
 * Animated thinking indicator shown while the build engine is working.
 */
export function BuildThinkingIndicator({ message }: { message: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
        <Bot className="w-4 h-4 text-primary-foreground animate-pulse" />
      </div>
      <div className="flex items-center gap-2 rounded-xl px-4 py-3 bg-card border border-card-border">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">{message}</span>
      </div>
    </div>
  );
}

/**
 * Final build summary displayed as rich markdown.
 */
export function BuildSummaryMessage({ content }: { content: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center shrink-0">
        <Sparkles className="w-4 h-4 text-white" />
      </div>
      <div className="max-w-[85%] rounded-xl px-4 py-3 bg-card border border-green-500/20">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  );
}

/**
 * Error message displayed when the build encounters a critical failure.
 */
export function BuildErrorMessage({ error }: { error: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-destructive flex items-center justify-center shrink-0">
        <AlertCircle className="w-4 h-4 text-destructive-foreground" />
      </div>
      <div className="max-w-[85%] rounded-xl px-4 py-3 bg-destructive/10 border border-destructive/30">
        <p className="text-sm font-medium text-destructive mb-1">Build Error</p>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    </div>
  );
}

/**
 * Shown when a build was interrupted (e.g. page refresh). Offers Resume + Dismiss actions.
 */
export function BuildInterruptedMessage({
  error,
  completedFiles,
  onResume,
  onDismiss,
}: {
  error: string;
  completedFiles: string[];
  onResume?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-yellow-500 flex items-center justify-center shrink-0">
        <AlertCircle className="w-4 h-4 text-white" />
      </div>
      <div className="max-w-[85%] rounded-xl px-4 py-3 bg-yellow-500/10 border border-yellow-500/30">
        <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400 mb-1">Build Interrupted</p>
        <p className="text-sm text-muted-foreground mb-2">{error}</p>
        {completedFiles.length > 0 && (
          <p className="text-xs text-muted-foreground mb-3">
            {completedFiles.length} file{completedFiles.length !== 1 ? "s" : ""} were created before the interruption.
          </p>
        )}
        <div className="flex gap-2">
          {onResume && (
            <Button size="sm" onClick={onResume}>
              <RefreshCw className="w-3 h-3 mr-1.5" /> Resume Build
            </Button>
          )}
          {onDismiss && (
            <Button size="sm" variant="outline" onClick={onDismiss}>
              <X className="w-3 h-3 mr-1.5" /> Dismiss
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Interactive error actions shown when a file fails after all retries.
 * Displays retry and cancel buttons so the user can decide what to do.
 */
export function BuildFileErrorActions({
  filePath,
  error,
  onRetry,
  onCancel,
}: {
  filePath: string;
  error: string;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-destructive flex items-center justify-center shrink-0">
        <AlertCircle className="w-4 h-4 text-destructive-foreground" />
      </div>
      <div className="max-w-[85%] rounded-xl px-4 py-3 bg-destructive/10 border border-destructive/30">
        <p className="text-sm font-medium text-destructive mb-1">
          Failed to generate: {filePath}
        </p>
        <p className="text-xs text-muted-foreground mb-3">{error}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="w-3 h-3 mr-1.5" /> Try Again
          </Button>
          <Button size="sm" variant="destructive" onClick={onCancel}>
            <X className="w-3 h-3 mr-1.5" /> Cancel Build
          </Button>
        </div>
      </div>
    </div>
  );
}
