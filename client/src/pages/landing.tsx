import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { 
  Blocks, 
  MessageSquare, 
  Globe, 
  Sparkles, 
  Zap, 
  Code2,
  ArrowRight,
  ChevronRight
} from "lucide-react";

const stats = [
  { label: "Plugins Created", value: "9,000+" },
  { label: "Tokens Used Monthly", value: "350M+" },
  { label: "Active Developers", value: "2,500+" },
];

const projectTypes = [
  { id: "minecraft", label: "Minecraft", icon: Blocks, active: true },
  { id: "discord", label: "Discord", icon: MessageSquare, active: false },
  { id: "web", label: "Web App", icon: Globe, active: false },
];

const features = [
  {
    icon: Sparkles,
    title: "Deep AI Reasoning",
    description: "Multi-step thought chains with verification passes",
  },
  {
    icon: Code2,
    title: "Full Project Generation",
    description: "Complete Maven structure with Java 21 code",
  },
  {
    icon: Zap,
    title: "Auto-Compilation",
    description: "Build and fix errors automatically",
  },
];

export default function Landing() {
  const [prompt, setPrompt] = useState("");
  const [selectedType, setSelectedType] = useState("minecraft");

  const handleLogin = () => {
    window.location.href = "/api/login";
  };

  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <Blocks className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-lg tracking-tight">AuroraCraft</span>
          </div>
          <Button onClick={handleLogin} data-testid="button-login">
            Sign In
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </nav>

      <main className="pt-32 pb-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <Badge variant="secondary" className="mb-6 px-4 py-1.5">
            <Sparkles className="w-3.5 h-3.5 mr-2" />
            AI-Powered Plugin Creation
          </Badge>

          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight mb-6 bg-gradient-to-br from-foreground via-foreground to-muted-foreground bg-clip-text">
            What should we build?
          </h1>

          <p className="text-xl text-muted-foreground mb-12 max-w-2xl mx-auto">
            Create astounding Minecraft plugins with no coding knowledge required. 
            Our AI reasons deeply to generate production-ready code.
          </p>

          <div className="flex items-center justify-center gap-2 mb-6">
            {projectTypes.map((type) => (
              <Button
                key={type.id}
                variant={selectedType === type.id ? "default" : "outline"}
                size="sm"
                onClick={() => type.active && setSelectedType(type.id)}
                disabled={!type.active}
                className={!type.active ? "opacity-50 cursor-not-allowed" : ""}
                data-testid={`button-type-${type.id}`}
              >
                <type.icon className="w-4 h-4 mr-2" />
                {type.label}
                {!type.active && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    Soon
                  </Badge>
                )}
              </Button>
            ))}
          </div>

          <div className="relative max-w-3xl mx-auto mb-8">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 rounded-xl blur-xl" />
            <div className="relative bg-card border border-card-border rounded-xl p-4">
              <Textarea
                placeholder="Describe your plugin idea... e.g., 'Create a plugin that adds custom enchantments with particle effects and a GUI to manage them'"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="min-h-32 resize-none border-0 bg-transparent focus-visible:ring-0 text-base"
                data-testid="input-prompt"
              />
              <div className="flex items-center justify-between gap-4 pt-4 border-t border-border/50">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Blocks className="w-4 h-4" />
                  <span>Paper / Spigot / Bukkit</span>
                </div>
                <Button 
                  onClick={handleLogin}
                  size="lg"
                  className="px-8"
                  data-testid="button-start-building"
                >
                  Start Building
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-8 max-w-2xl mx-auto mb-24">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl font-bold text-foreground mb-1" data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g, '-')}`}>
                  {stat.value}
                </div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="p-6 rounded-xl bg-card border border-card-border hover-elevate"
              >
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Blocks className="w-4 h-4" />
            <span>AuroraCraft</span>
          </div>
          <p>AI-powered Minecraft plugin development</p>
        </div>
      </footer>
    </div>
  );
}
