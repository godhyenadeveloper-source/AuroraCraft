import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import type { TokenUsage } from "@shared/schema";
import {
  ArrowLeft,
  Coins,
  MessageSquare,
  Sparkles,
  Zap,
  TrendingDown,
  Calendar,
} from "lucide-react";

export default function TokensPage() {
  const { user, isLoading: userLoading } = useAuth();

  const { data: tokenUsage, isLoading: usageLoading } = useQuery<TokenUsage[]>({
    queryKey: ["/api/token-usage"],
    enabled: !!user,
  });

  const getActionIcon = (action: string) => {
    switch (action) {
      case "chat":
        return <MessageSquare className="w-4 h-4" />;
      case "enhance_prompt":
        return <Sparkles className="w-4 h-4" />;
      case "compile":
        return <Zap className="w-4 h-4" />;
      default:
        return <Coins className="w-4 h-4" />;
    }
  };

  const getActionLabel = (action: string) => {
    switch (action) {
      case "chat":
        return "Chat Message";
      case "enhance_prompt":
        return "Prompt Enhancement";
      case "compile":
        return "Compilation";
      default:
        return action;
    }
  };

  const formatDate = (date: string | Date | null) => {
    if (!date) return "Unknown";
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const totalUsed = tokenUsage?.reduce((acc, u) => acc + u.tokensUsed, 0) || 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="h-14 border-b border-border flex items-center px-4 gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <h1 className="font-semibold">Token Usage</h1>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium">Current Balance</CardTitle>
              <Coins className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              {userLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-token-balance">
                  {user?.tokenBalance?.toLocaleString() || 0}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium">Total Used</CardTitle>
              <TrendingDown className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {usageLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-tokens-used">
                  {totalUsed.toLocaleString()}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium">Transactions</CardTitle>
              <Calendar className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {usageLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-transaction-count">
                  {tokenUsage?.length || 0}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Usage History</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-96">
              {usageLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="w-8 h-8 rounded-full" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      <Skeleton className="h-6 w-16" />
                    </div>
                  ))}
                </div>
              ) : tokenUsage?.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Coins className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No token usage yet</p>
                  <p className="text-sm mt-1">Start chatting to see your token usage history</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {tokenUsage?.map((usage) => (
                    <div
                      key={usage.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-card border border-card-border"
                      data-testid={`usage-${usage.id}`}
                    >
                      <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
                        {getActionIcon(usage.action)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{getActionLabel(usage.action)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(usage.createdAt)}
                        </p>
                      </div>
                      <Badge variant="secondary">
                        -{usage.tokensUsed.toLocaleString()}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
