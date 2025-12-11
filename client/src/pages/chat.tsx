import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ChatSession, ChatMessage, Model, ProjectFile, Compilation } from "@shared/schema";
import {
  ArrowLeft,
  Send,
  Square,
  Sparkles,
  Bot,
  User,
  Coins,
  Download,
  Play,
  FileCode,
  Folder,
  FolderOpen,
  File,
  Plus,
  Trash2,
  Edit2,
  ChevronRight,
  ChevronDown,
  MoreVertical,
  Check,
  X,
  Package,
  AlertCircle,
  Loader2,
  Wrench,
} from "lucide-react";

interface FileTreeItem {
  id: number;
  name: string;
  path: string;
  isFolder: boolean;
  children?: FileTreeItem[];
  content?: string;
}

function buildFileTree(files: ProjectFile[]): FileTreeItem[] {
  const root: FileTreeItem[] = [];
  const folders: Map<string, FileTreeItem> = new Map();

  files.forEach((file) => {
    const pathParts = file.path.split("/").filter(Boolean);
    let currentPath = "";
    let currentLevel = root;

    pathParts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLastPart = index === pathParts.length - 1;

      if (isLastPart && !file.isFolder) {
        currentLevel.push({
          id: file.id,
          name: file.name,
          path: file.path,
          isFolder: false,
          content: file.content || "",
        });
      } else {
        let folder = folders.get(currentPath);
        if (!folder) {
          folder = {
            id: file.isFolder && isLastPart ? file.id : -Date.now(),
            name: part,
            path: currentPath,
            isFolder: true,
            children: [],
          };
          folders.set(currentPath, folder);
          currentLevel.push(folder);
        }
        currentLevel = folder.children!;
      }
    });
  });

  const sortTree = (items: FileTreeItem[]): FileTreeItem[] => {
    return items.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  };

  const sortRecursive = (items: FileTreeItem[]): FileTreeItem[] => {
    return sortTree(items).map((item) => ({
      ...item,
      children: item.children ? sortRecursive(item.children) : undefined,
    }));
  };

  return sortRecursive(root);
}

function FileTreeNode({
  item,
  level,
  selectedFile,
  onSelect,
  expandedFolders,
  onToggleFolder,
}: {
  item: FileTreeItem;
  level: number;
  selectedFile: FileTreeItem | null;
  onSelect: (file: FileTreeItem) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
}) {
  const isExpanded = expandedFolders.has(item.path);
  const isSelected = selectedFile?.path === item.path;

  const getFileIcon = (name: string) => {
    if (name.endsWith(".java")) return <FileCode className="w-4 h-4 text-orange-400" />;
    if (name.endsWith(".xml") || name.endsWith(".yml") || name.endsWith(".yaml"))
      return <FileCode className="w-4 h-4 text-yellow-400" />;
    if (name.endsWith(".json")) return <FileCode className="w-4 h-4 text-green-400" />;
    if (name.endsWith(".md")) return <File className="w-4 h-4 text-blue-400" />;
    return <File className="w-4 h-4 text-muted-foreground" />;
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1 text-sm cursor-pointer hover-elevate rounded-md ${
          isSelected ? "bg-accent text-accent-foreground" : ""
        }`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => {
          if (item.isFolder) {
            onToggleFolder(item.path);
          } else {
            onSelect(item);
          }
        }}
        data-testid={`file-${item.path.replace(/\//g, "-")}`}
      >
        {item.isFolder ? (
          <>
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            {isExpanded ? (
              <FolderOpen className="w-4 h-4 text-primary" />
            ) : (
              <Folder className="w-4 h-4 text-primary" />
            )}
          </>
        ) : (
          <>
            <span className="w-4" />
            {getFileIcon(item.name)}
          </>
        )}
        <span className="truncate ml-1">{item.name}</span>
      </div>
      {item.isFolder && isExpanded && item.children && (
        <div>
          {item.children.map((child) => (
            <FileTreeNode
              key={child.path}
              item={child}
              level={level + 1}
              selectedFile={selectedFile}
              onSelect={onSelect}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  const [, params] = useRoute("/chat/:id");
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const sessionId = params?.id ? parseInt(params.id) : null;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"agent" | "plan" | "question">("agent");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileTreeItem | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["src"]));
  const [editorContent, setEditorContent] = useState("");

  const { data: session, isLoading: sessionLoading } = useQuery<ChatSession>({
    queryKey: ["/api/sessions", sessionId],
    enabled: !!sessionId,
  });

  const { data: messages, isLoading: messagesLoading } = useQuery<ChatMessage[]>({
    queryKey: ["/api/sessions", sessionId, "messages"],
    enabled: !!sessionId,
  });

  const { data: files, isLoading: filesLoading } = useQuery<ProjectFile[]>({
    queryKey: ["/api/sessions", sessionId, "files"],
    enabled: !!sessionId,
  });

  const { data: models } = useQuery<Model[]>({
    queryKey: ["/api/models"],
  });

  const { data: compilations } = useQuery<Compilation[]>({
    queryKey: ["/api/sessions", sessionId, "compilations"],
    enabled: !!sessionId,
  });

  const sendMessage = useMutation({
    mutationFn: async (content: string) => {
      setIsStreaming(true);
      const response = await apiRequest("POST", `/api/sessions/${sessionId}/chat`, {
        content,
        mode,
        modelId: selectedModel ? parseInt(selectedModel) : undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setMessage("");
      setIsStreaming(false);
    },
    onError: (error) => {
      setIsStreaming(false);
      toast({
        title: "Error",
        description: error.message || "Failed to send message",
        variant: "destructive",
      });
    },
  });

  const compile = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/sessions/${sessionId}/compile`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId, "compilations"] });
      toast({ title: "Compilation started" });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to start compilation",
        variant: "destructive",
      });
    },
  });

  const fixErrors = useMutation({
    mutationFn: async (errorMessage: string) => {
      const response = await apiRequest("POST", `/api/sessions/${sessionId}/chat`, {
        content: `The compilation failed with the following errors. Please fix them:\n\n${errorMessage}`,
        mode: "agent",
        modelId: selectedModel ? parseInt(selectedModel) : undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId, "files"] });
      toast({ title: "Fixing errors..." });
    },
  });

  const saveFile = useMutation({
    mutationFn: async ({ id, content }: { id: number; content: string }) => {
      const response = await apiRequest("PATCH", `/api/files/${id}`, { content });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId, "files"] });
      toast({ title: "File saved" });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (models?.length && !selectedModel) {
      setSelectedModel(models[0].id.toString());
    }
  }, [models, selectedModel]);

  useEffect(() => {
    if (selectedFile && !selectedFile.isFolder) {
      setEditorContent(selectedFile.content || "");
    }
  }, [selectedFile]);

  const fileTree = files ? buildFileTree(files) : [];
  const latestCompilation = compilations?.[0];

  const handleToggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleSend = () => {
    if (!message.trim() || isStreaming) return;
    sendMessage.mutate(message);
  };

  if (!sessionId) {
    navigate("/");
    return null;
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="h-14 border-b border-border flex items-center justify-between px-4 gap-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="font-medium truncate max-w-64" data-testid="text-session-name">
            {sessionLoading ? <Skeleton className="h-5 w-32" /> : session?.name}
          </h1>
          <Badge variant="secondary" className="text-xs">
            {session?.framework || "Paper"}
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-card-border">
            <Coins className="w-4 h-4 text-primary" />
            <span className="font-medium text-sm">{user?.tokenBalance?.toLocaleString() || 0}</span>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => compile.mutate()}
            disabled={compile.isPending}
            data-testid="button-compile"
          >
            {compile.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            Compile
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-download">
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => window.open(`/api/sessions/${sessionId}/download`, "_blank")}
                data-testid="button-download-source"
              >
                <Package className="w-4 h-4 mr-2" />
                Download Source (ZIP)
              </DropdownMenuItem>
              {latestCompilation?.status === "success" && latestCompilation.artifactPath && (
                <DropdownMenuItem
                  onClick={() =>
                    window.open(`/api/compilations/${latestCompilation.id}/artifact`, "_blank")
                  }
                  data-testid="button-download-jar"
                >
                  <FileCode className="w-4 h-4 mr-2" />
                  Download JAR
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel defaultSize={40} minSize={30}>
          <div className="h-full flex flex-col">
            <div className="p-3 border-b border-border flex items-center gap-2">
              <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <TabsList>
                  <TabsTrigger value="agent" data-testid="tab-agent">
                    <Bot className="w-4 h-4 mr-1.5" />
                    Agent
                  </TabsTrigger>
                  <TabsTrigger value="plan" data-testid="tab-plan">
                    <FileCode className="w-4 h-4 mr-1.5" />
                    Plan
                  </TabsTrigger>
                  <TabsTrigger value="question" data-testid="tab-question">
                    <Sparkles className="w-4 h-4 mr-1.5" />
                    Question
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messagesLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex gap-3">
                      <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-1/4" />
                        <Skeleton className="h-20 w-full" />
                      </div>
                    </div>
                  ))
                ) : messages?.length === 0 ? (
                  <div className="text-center py-12">
                    <Bot className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                    <h3 className="font-medium mb-2">Start building</h3>
                    <p className="text-sm text-muted-foreground">
                      Describe what you want to create
                    </p>
                  </div>
                ) : (
                  messages?.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
                      data-testid={`message-${msg.id}`}
                    >
                      {msg.role === "assistant" && (
                        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                          <Bot className="w-4 h-4 text-primary-foreground" />
                        </div>
                      )}
                      <div
                        className={`max-w-[85%] rounded-xl px-4 py-3 ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-card border border-card-border"
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      </div>
                      {msg.role === "user" && (
                        <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center shrink-0">
                          <User className="w-4 h-4" />
                        </div>
                      )}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <div className="p-4 border-t border-border">
              <div className="flex items-center gap-2 mb-3">
                <Select value={selectedModel} onValueChange={setSelectedModel}>
                  <SelectTrigger className="w-48" data-testid="select-model">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {models?.map((model) => (
                      <SelectItem key={model.id} value={model.id.toString()}>
                        {model.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button variant="outline" size="sm" data-testid="button-enhance">
                  <Sparkles className="w-4 h-4 mr-1.5" />
                  Enhance
                </Button>
              </div>

              <div className="relative">
                <Textarea
                  placeholder={
                    mode === "agent"
                      ? "Describe what you want to build..."
                      : mode === "plan"
                      ? "Describe the plugin architecture..."
                      : "Ask a question about your project..."
                  }
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  className="min-h-24 pr-12 resize-none"
                  data-testid="input-message"
                />
                <Button
                  size="icon"
                  className="absolute bottom-3 right-3"
                  onClick={isStreaming ? () => setIsStreaming(false) : handleSend}
                  disabled={!message.trim() && !isStreaming}
                  variant={isStreaming ? "destructive" : "default"}
                  data-testid="button-send"
                >
                  {isStreaming ? (
                    <Square className="w-4 h-4" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={60} minSize={40}>
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={25} minSize={15}>
              <div className="h-full flex flex-col border-r border-border">
                <div className="p-3 border-b border-border flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">Files</span>
                  <Button variant="ghost" size="icon" className="w-7 h-7">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                <ScrollArea className="flex-1">
                  <div className="py-2">
                    {filesLoading ? (
                      <div className="space-y-1 px-2">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Skeleton key={i} className="h-6 w-full" />
                        ))}
                      </div>
                    ) : fileTree.length === 0 ? (
                      <div className="text-center py-8 px-4">
                        <Folder className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">
                          No files yet
                        </p>
                      </div>
                    ) : (
                      fileTree.map((item) => (
                        <FileTreeNode
                          key={item.path}
                          item={item}
                          level={0}
                          selectedFile={selectedFile}
                          onSelect={setSelectedFile}
                          expandedFolders={expandedFolders}
                          onToggleFolder={handleToggleFolder}
                        />
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            </ResizablePanel>

            <ResizableHandle />

            <ResizablePanel defaultSize={75}>
              <div className="h-full flex flex-col">
                {selectedFile && !selectedFile.isFolder ? (
                  <>
                    <div className="h-10 border-b border-border flex items-center px-3 gap-2">
                      <Badge variant="outline" className="text-xs font-mono">
                        {selectedFile.name}
                      </Badge>
                      <div className="flex-1" />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          saveFile.mutate({
                            id: selectedFile.id,
                            content: editorContent,
                          })
                        }
                        disabled={saveFile.isPending}
                        data-testid="button-save-file"
                      >
                        {saveFile.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                        <span className="ml-1.5">Save</span>
                      </Button>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <textarea
                        value={editorContent}
                        onChange={(e) => setEditorContent(e.target.value)}
                        className="w-full h-full p-4 font-mono text-sm bg-background resize-none focus:outline-none"
                        spellCheck={false}
                        data-testid="editor-content"
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <FileCode className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p className="text-sm">Select a file to edit</p>
                    </div>
                  </div>
                )}

                {latestCompilation && (
                  <div className="border-t border-border">
                    <div className="p-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Build</span>
                        <Badge
                          variant={
                            latestCompilation.status === "success"
                              ? "default"
                              : latestCompilation.status === "failed"
                              ? "destructive"
                              : "secondary"
                          }
                          className="text-xs"
                        >
                          {latestCompilation.status === "success" && (
                            <Check className="w-3 h-3 mr-1" />
                          )}
                          {latestCompilation.status === "failed" && (
                            <X className="w-3 h-3 mr-1" />
                          )}
                          {latestCompilation.status === "running" && (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          )}
                          {latestCompilation.status}
                        </Badge>
                      </div>
                      {latestCompilation.status === "failed" && latestCompilation.errorMessage && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fixErrors.mutate(latestCompilation.errorMessage!)}
                          disabled={fixErrors.isPending}
                          data-testid="button-fix-errors"
                        >
                          <Wrench className="w-4 h-4 mr-1.5" />
                          Fix Errors
                        </Button>
                      )}
                    </div>
                    {latestCompilation.logs && (
                      <ScrollArea className="h-32 border-t border-border">
                        <pre className="p-3 text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                          {latestCompilation.logs}
                        </pre>
                      </ScrollArea>
                    )}
                  </div>
                )}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
