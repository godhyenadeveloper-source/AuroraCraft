import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User, Provider, Model, SiteSetting } from "@shared/schema";
import {
  ArrowLeft,
  Blocks,
  Settings,
  Users,
  Cpu,
  Layers,
  Plus,
  Trash2,
  Edit2,
  MoreVertical,
  Shield,
  ShieldOff,
  Save,
  Check,
  X,
  Loader2,
  BarChart3,
} from "lucide-react";

type AdminTab = "overview" | "users" | "providers" | "models" | "analytics";

export default function AdminPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");

  useEffect(() => {
    if (user && !user.isAdmin) {
      navigate("/");
      toast({
        title: "Access Denied",
        description: "You don't have permission to access this page",
        variant: "destructive",
      });
    }
  }, [user, navigate, toast]);

  if (!user?.isAdmin) {
    return null;
  }

  const tabs = [
    { id: "overview" as const, label: "Overview", icon: Settings },
    { id: "users" as const, label: "Users", icon: Users },
    { id: "providers" as const, label: "Providers", icon: Cpu },
    { id: "models" as const, label: "Models", icon: Layers },
    { id: "analytics" as const, label: "Analytics", icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")} data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <Blocks className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-lg tracking-tight">Admin Panel</span>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8 flex gap-8">
        <aside className="w-56 shrink-0">
          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover-elevate"
                }`}
                data-testid={`tab-${tab.id}`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 min-w-0">
          {activeTab === "overview" && <OverviewSection />}
          {activeTab === "users" && <UsersSection />}
          {activeTab === "providers" && <ProvidersSection />}
          {activeTab === "models" && <ModelsSection />}
          {activeTab === "analytics" && <AnalyticsSection />}
        </main>
      </div>
    </div>
  );
}

function OverviewSection() {
  const { toast } = useToast();
  const [siteName, setSiteName] = useState("AuroraCraft");

  const { data: settings, isLoading } = useQuery<SiteSetting[]>({
    queryKey: ["/api/admin/settings"],
  });

  const updateSetting = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      return await apiRequest("POST", "/api/admin/settings", { key, value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({ title: "Settings saved" });
    },
  });

  useEffect(() => {
    const nameSetting = settings?.find((s) => s.key === "site_name");
    if (nameSetting) setSiteName(nameSetting.value || "AuroraCraft");
  }, [settings]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Overview</h2>
        <p className="text-muted-foreground">Manage your site settings</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Site Configuration</CardTitle>
          <CardDescription>Update your site name and branding</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="site-name">Site Name</Label>
            <div className="flex gap-2">
              <Input
                id="site-name"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="AuroraCraft"
                data-testid="input-site-name"
              />
              <Button
                onClick={() => updateSetting.mutate({ key: "site_name", value: siteName })}
                disabled={updateSetting.isPending}
                data-testid="button-save-site-name"
              >
                {updateSetting.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UsersSection() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
  });

  const toggleAdmin = useMutation({
    mutationFn: async ({ userId, isAdmin }: { userId: string; isAdmin: boolean }) => {
      return await apiRequest("PATCH", `/api/admin/users/${userId}`, { isAdmin });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User updated" });
    },
  });

  const deleteUser = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest("DELETE", `/api/admin/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User deleted" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Users</h2>
        <p className="text-muted-foreground">Manage user accounts and permissions</p>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Tokens</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users?.map((user) => (
              <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    {user.profileImageUrl ? (
                      <img
                        src={user.profileImageUrl}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-medium text-primary">
                          {user.firstName?.[0] || user.email?.[0] || "U"}
                        </span>
                      </div>
                    )}
                    <span className="font-medium">
                      {user.firstName} {user.lastName}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{user.email}</TableCell>
                <TableCell>{user.tokenBalance?.toLocaleString()}</TableCell>
                <TableCell>
                  {user.isAdmin ? (
                    <Badge>Admin</Badge>
                  ) : (
                    <Badge variant="secondary">User</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {user.id !== currentUser?.id && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            toggleAdmin.mutate({
                              userId: user.id,
                              isAdmin: !user.isAdmin,
                            })
                          }
                        >
                          {user.isAdmin ? (
                            <>
                              <ShieldOff className="w-4 h-4 mr-2" />
                              Remove Admin
                            </>
                          ) : (
                            <>
                              <Shield className="w-4 h-4 mr-2" />
                              Make Admin
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => deleteUser.mutate(user.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function ProvidersSection() {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    baseUrl: "",
    authType: "bearer",
    apiKey: "",
    customHeaders: "{}",
    healthCheckEndpoint: "",
  });

  const { data: providers, isLoading } = useQuery<Provider[]>({
    queryKey: ["/api/admin/providers"],
  });

  const createProvider = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("POST", "/api/admin/providers", {
        ...data,
        customHeaders: JSON.parse(data.customHeaders || "{}"),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      setIsAddOpen(false);
      resetForm();
      toast({ title: "Provider created" });
    },
  });

  const updateProvider = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      return await apiRequest("PATCH", `/api/admin/providers/${id}`, {
        ...data,
        customHeaders: JSON.parse(data.customHeaders || "{}"),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      setEditingProvider(null);
      resetForm();
      toast({ title: "Provider updated" });
    },
  });

  const deleteProvider = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/admin/providers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/providers"] });
      toast({ title: "Provider deleted" });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      baseUrl: "",
      authType: "bearer",
      apiKey: "",
      customHeaders: "{}",
      healthCheckEndpoint: "",
    });
  };

  useEffect(() => {
    if (editingProvider) {
      setFormData({
        name: editingProvider.name,
        baseUrl: editingProvider.baseUrl,
        authType: editingProvider.authType,
        apiKey: editingProvider.apiKey || "",
        customHeaders: JSON.stringify(editingProvider.customHeaders || {}, null, 2),
        healthCheckEndpoint: editingProvider.healthCheckEndpoint || "",
      });
    }
  }, [editingProvider]);

  const ProviderForm = ({ onSubmit, isEditing }: { onSubmit: () => void; isEditing: boolean }) => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Provider Name</Label>
        <Input
          value={formData.name}
          onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
          placeholder="OpenAI"
          data-testid="input-provider-name"
        />
      </div>
      <div className="space-y-2">
        <Label>Base URL</Label>
        <Input
          value={formData.baseUrl}
          onChange={(e) => setFormData((f) => ({ ...f, baseUrl: e.target.value }))}
          placeholder="https://api.openai.com/v1"
          data-testid="input-provider-url"
        />
      </div>
      <div className="space-y-2">
        <Label>Auth Type</Label>
        <Select
          value={formData.authType}
          onValueChange={(v) => setFormData((f) => ({ ...f, authType: v }))}
        >
          <SelectTrigger data-testid="select-auth-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bearer">Bearer Token</SelectItem>
            <SelectItem value="api_key">API Key</SelectItem>
            <SelectItem value="custom">Custom Header</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>API Key</Label>
        <Input
          type="password"
          value={formData.apiKey}
          onChange={(e) => setFormData((f) => ({ ...f, apiKey: e.target.value }))}
          placeholder="sk-..."
          data-testid="input-provider-api-key"
        />
      </div>
      <div className="space-y-2">
        <Label>Custom Headers (JSON)</Label>
        <Textarea
          value={formData.customHeaders}
          onChange={(e) => setFormData((f) => ({ ...f, customHeaders: e.target.value }))}
          placeholder="{}"
          className="font-mono text-sm"
          data-testid="input-provider-headers"
        />
      </div>
      <div className="space-y-2">
        <Label>Health Check Endpoint</Label>
        <Input
          value={formData.healthCheckEndpoint}
          onChange={(e) => setFormData((f) => ({ ...f, healthCheckEndpoint: e.target.value }))}
          placeholder="/health"
          data-testid="input-provider-health"
        />
      </div>
      <Button onClick={onSubmit} className="w-full" data-testid="button-save-provider">
        {isEditing ? "Update Provider" : "Create Provider"}
      </Button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">AI Providers</h2>
          <p className="text-muted-foreground">Configure AI providers and API connections</p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-provider">
              <Plus className="w-4 h-4 mr-2" />
              Add Provider
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Provider</DialogTitle>
            </DialogHeader>
            <ProviderForm
              onSubmit={() => createProvider.mutate(formData)}
              isEditing={false}
            />
          </DialogContent>
        </Dialog>
      </div>

      {providers?.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Cpu className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="font-medium text-lg mb-2">No providers configured</h3>
            <p className="text-muted-foreground mb-6">Add your first AI provider to get started</p>
            <Button onClick={() => setIsAddOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Provider
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {providers?.map((provider) => (
            <Card key={provider.id} data-testid={`card-provider-${provider.id}`}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                <div>
                  <CardTitle className="text-base">{provider.name}</CardTitle>
                  <CardDescription className="text-xs truncate max-w-48">
                    {provider.authType === "puterjs" ? "User-Pays (no API key)" : provider.baseUrl}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={provider.isEnabled ? "default" : "secondary"}>
                    {provider.isEnabled ? "Enabled" : "Disabled"}
                  </Badge>
                  {provider.authType === "puterjs" ? (
                    <Badge variant="secondary">Built-in</Badge>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditingProvider(provider)}>
                          <Edit2 className="w-4 h-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => deleteProvider.mutate(provider.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="outline" className="text-xs">
                    {provider.authType === "puterjs" ? "user-pays" : provider.authType}
                  </Badge>
                  {provider.authType === "puterjs" && (
                    <span className="text-xs">No API key required</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editingProvider} onOpenChange={() => setEditingProvider(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Provider</DialogTitle>
          </DialogHeader>
          <ProviderForm
            onSubmit={() =>
              editingProvider && updateProvider.mutate({ id: editingProvider.id, data: formData })
            }
            isEditing={true}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModelsSection() {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);

  const [formData, setFormData] = useState({
    providerId: "",
    name: "",
    displayName: "",
    description: "",
    tokenCostPerChar: "1",
    inputCostPerKChar: "0",
    outputCostPerKChar: "0",
  });

  const { data: models, isLoading } = useQuery<Model[]>({
    queryKey: ["/api/admin/models"],
  });

  const { data: providers } = useQuery<Provider[]>({
    queryKey: ["/api/admin/providers"],
  });

  const selectedProvider = providers?.find((p) => p.id.toString() === formData.providerId);
  const isPuterProvider = selectedProvider?.authType === "puterjs";

  const createModel = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("POST", "/api/admin/models", {
        providerId: parseInt(data.providerId),
        name: data.name,
        displayName: data.displayName,
        description: data.description || undefined,
        tokenCostPerChar: parseInt(data.tokenCostPerChar || "0") || 0,
        inputCostPerKChar: parseInt(data.inputCostPerKChar || "0") || 0,
        outputCostPerKChar: parseInt(data.outputCostPerKChar || "0") || 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models"] });
      queryClient.invalidateQueries({ queryKey: ["/api/models"] });
      setIsAddOpen(false);
      setFormData({
        providerId: "",
        name: "",
        displayName: "",
        description: "",
        tokenCostPerChar: "1",
        inputCostPerKChar: "0",
        outputCostPerKChar: "0",
      });
      toast({ title: "Model created" });
    },
  });

  const toggleModel = useMutation({
    mutationFn: async ({ id, field, value }: { id: number; field: string; value: boolean }) => {
      return await apiRequest("PATCH", `/api/admin/models/${id}`, { [field]: value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models"] });
      queryClient.invalidateQueries({ queryKey: ["/api/models"] });
    },
  });

  const deleteModel = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/admin/models/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/models"] });
      queryClient.invalidateQueries({ queryKey: ["/api/models"] });
      toast({ title: "Model deleted" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">AI Models</h2>
          <p className="text-muted-foreground">Configure available models and pricing</p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-model">
              <Plus className="w-4 h-4 mr-2" />
              Add Model
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Model</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select
                  value={formData.providerId}
                  onValueChange={(v) => setFormData((f) => ({ ...f, providerId: v }))}
                >
                  <SelectTrigger data-testid="select-model-provider">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers?.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isPuterProvider && (
                <div className="space-y-2">
                  <Label>Puter.js Model Preset</Label>
                  <Select
                    onValueChange={(v) => {
                      if (v === "claude-sonnet-4-5") {
                        setFormData((f) => ({
                          ...f,
                          name: "claude-sonnet-4-5",
                          displayName: "Claude Sonnet 4.5",
                          description: "Claude Sonnet 4.5 via Puter.js",
                        }));
                      } else if (v === "claude-opus-4-5") {
                        setFormData((f) => ({
                          ...f,
                          name: "claude-opus-4-5",
                          displayName: "Claude Opus 4.5",
                          description: "Claude Opus 4.5 via Puter.js",
                        }));
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Claude model" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="claude-sonnet-4-5">Claude Sonnet 4.5</SelectItem>
                      <SelectItem value="claude-opus-4-5">Claude Opus 4.5</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label>Model ID (API)</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                  placeholder={isPuterProvider ? "claude-sonnet-4-5" : "gpt-4"}
                  data-testid="input-model-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Display Name</Label>
                <Input
                  value={formData.displayName}
                  onChange={(e) => setFormData((f) => ({ ...f, displayName: e.target.value }))}
                  placeholder="GPT-4"
                  data-testid="input-model-display-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData((f) => ({ ...f, description: e.target.value }))}
                  placeholder={
                    isPuterProvider
                      ? "Claude model via Puter.js (user-pays)"
                      : "Short description of this model"
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Legacy Token Cost (per character)</Label>
                <Input
                  type="number"
                  value={formData.tokenCostPerChar}
                  onChange={(e) => setFormData((f) => ({ ...f, tokenCostPerChar: e.target.value }))}
                  placeholder="1"
                  data-testid="input-model-cost"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Input cost (per 1k characters)</Label>
                  <Input
                    type="number"
                    value={formData.inputCostPerKChar}
                    onChange={(e) =>
                      setFormData((f) => ({ ...f, inputCostPerKChar: e.target.value }))
                    }
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Output cost (per 1k characters)</Label>
                  <Input
                    type="number"
                    value={formData.outputCostPerKChar}
                    onChange={(e) =>
                      setFormData((f) => ({ ...f, outputCostPerKChar: e.target.value }))
                    }
                    placeholder="0"
                  />
                </div>
              </div>
              <Button
                onClick={() => createModel.mutate(formData)}
                className="w-full"
                disabled={!formData.providerId || !formData.name || !formData.displayName}
                data-testid="button-save-model"
              >
                Create Model
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {models?.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Layers className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="font-medium text-lg mb-2">No models configured</h3>
            <p className="text-muted-foreground mb-6">Add your first AI model</p>
            <Button onClick={() => setIsAddOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Model
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Visible</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models?.map((model) => (
                <TableRow key={model.id} data-testid={`row-model-${model.id}`}>
                  <TableCell>
                    <div>
                      <span className="font-medium">{model.displayName}</span>
                      <span className="text-xs text-muted-foreground block font-mono">
                        {model.name}
                      </span>
                      {model.description && (
                        <span className="text-xs text-muted-foreground block">
                          {model.description}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {providers?.find((p) => p.id === model.providerId)?.name || "-"}
                  </TableCell>
                  <TableCell>
                    {model.inputCostPerKChar || model.outputCostPerKChar ? (
                      <span className="text-xs">
                        {model.inputCostPerKChar || 0}/1k in, {model.outputCostPerKChar || 0}
                        /1k out
                      </span>
                    ) : (
                      <span className="text-xs">{model.tokenCostPerChar}/char</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={model.isEnabled ?? false}
                      onCheckedChange={(checked) =>
                        toggleModel.mutate({ id: model.id, field: "isEnabled", value: checked })
                      }
                      data-testid={`switch-model-enabled-${model.id}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={model.isVisible ?? false}
                      onCheckedChange={(checked) =>
                        toggleModel.mutate({ id: model.id, field: "isVisible", value: checked })
                      }
                      data-testid={`switch-model-visible-${model.id}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteModel.mutate(model.id)}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function AnalyticsSection() {
  const { data: stats, isLoading } = useQuery<{
    totalUsers: number;
    totalSessions: number;
    totalTokensUsed: number;
    totalCompilations: number;
  }>({
    queryKey: ["/api/admin/stats"],
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
        <p className="text-muted-foreground">Overview of platform usage</p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardDescription>Total Users</CardDescription>
            <CardTitle className="text-3xl" data-testid="stat-total-users">
              {stats?.totalUsers?.toLocaleString() || 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Total Sessions</CardDescription>
            <CardTitle className="text-3xl" data-testid="stat-total-sessions">
              {stats?.totalSessions?.toLocaleString() || 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Tokens Used</CardDescription>
            <CardTitle className="text-3xl" data-testid="stat-total-tokens">
              {stats?.totalTokensUsed?.toLocaleString() || 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Compilations</CardDescription>
            <CardTitle className="text-3xl" data-testid="stat-total-compilations">
              {stats?.totalCompilations?.toLocaleString() || 0}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
