import { FormEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { ExternalLink, Eye, EyeOff, KeyRound, Loader2, Save, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ApiKeyStatus {
  youtube: boolean;
  ai: {
    apiKeyConfigured: boolean;
    baseUrl: string;
    textModel: string;
    imageModel: string;
    imageSize: string;
    localEndpoint: boolean;
    legacyGeminiConfig: boolean;
  };
}

interface KeyFieldProps {
  id: string;
  label: string;
  description: string;
  configured: boolean;
  inputRef: RefObject<HTMLInputElement>;
  providerUrl?: string;
  providerLabel?: string;
  children?: ReactNode;
}

const COMMUNITIES = [
  {
    id: "free",
    title: "AI Marketing Hub",
    tier: "Free community",
    url: "https://www.skool.com/ai-marketing-hub",
    colors: ["#F1B43C", "#3D8FD1", "#D64A43"],
  },
  {
    id: "pro",
    title: "AI Marketing Hub Pro",
    tier: "Pro community",
    url: "https://www.skool.com/ai-marketing-hub-pro",
    colors: ["#D64A43", "#E2A33A", "#4D9B65"],
  },
] as const;

function CommunityMark({ colors }: { colors: readonly [string, string, string] }) {
  const heights = ["h-3", "h-5", "h-4"] as const;
  return (
    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-end justify-center gap-1 rounded-lg border border-border bg-background px-2 pb-2">
      {colors.map((color, index) => (
        <span className={`w-1 rounded-full ${heights[index]}`} key={color} style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}

function KeyField({
  id,
  label,
  description,
  configured,
  inputRef,
  providerUrl,
  providerLabel,
  children,
}: KeyFieldProps) {
  const [showKey, setShowKey] = useState(false);
  return (
    <div className="space-y-3 rounded-lg border border-border bg-background/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label htmlFor={id} className="text-base">{label}</Label>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Badge variant="outline" className={configured ? "border-green-500/40 bg-green-500/10 text-green-500" : "text-muted-foreground"}>
          {configured ? "Configured" : "Not configured"}
        </Badge>
      </div>
      <div className="relative">
        <Input
          ref={inputRef}
          id={id}
          name={id}
          type={showKey ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          placeholder={configured ? "Enter a replacement key" : "Paste API key"}
          className="pr-11 font-mono"
          data-testid={`input-${id}`}
        />
        <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => setShowKey((visible) => !visible)} aria-label={showKey ? `Hide ${label}` : `Show ${label}`}>
          {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
      {children}
      {providerUrl && providerLabel && (
        <a href={providerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          {providerLabel}<ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [status, setStatus] = useState<ApiKeyStatus>({
    youtube: false,
    ai: {
      apiKeyConfigured: false,
      baseUrl: "http://127.0.0.1:8080/v1",
      textModel: "local-model",
      imageModel: "",
      imageSize: "1536x1024",
      localEndpoint: true,
      legacyGeminiConfig: false,
    },
  });
  const [aiBaseUrl, setAiBaseUrl] = useState(status.ai.baseUrl);
  const [aiTextModel, setAiTextModel] = useState(status.ai.textModel);
  const [aiImageModel, setAiImageModel] = useState(status.ai.imageModel);
  const [aiImageSize, setAiImageSize] = useState(status.ai.imageSize);
  const [clearAiKey, setClearAiKey] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const youtubeKeyRef = useRef<HTMLInputElement>(null);
  const aiKeyRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const applyStatus = (nextStatus: ApiKeyStatus) => {
    setStatus(nextStatus);
    setAiBaseUrl(nextStatus.ai.baseUrl);
    setAiTextModel(nextStatus.ai.textModel);
    setAiImageModel(nextStatus.ai.imageModel);
    setAiImageSize(nextStatus.ai.imageSize);
    setClearAiKey(false);
  };

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const response = await fetch("/api/settings/status", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load settings.");
        applyStatus(data as ApiKeyStatus);
      } catch (error: any) {
        setLoadError(error?.message || "Unable to load settings.");
      } finally {
        setIsLoading(false);
      }
    };
    loadStatus();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const youtubeApiKey = youtubeKeyRef.current?.value.trim() || "";
    const aiApiKey = aiKeyRef.current?.value.trim() || "";
    const configChanged = aiBaseUrl.trim() !== status.ai.baseUrl
      || aiTextModel.trim() !== status.ai.textModel
      || aiImageModel.trim() !== status.ai.imageModel
      || aiImageSize.trim() !== status.ai.imageSize;

    if (!youtubeApiKey && !aiApiKey && !clearAiKey && !configChanged) {
      toast({ title: "No changes to save", description: "Change a connection setting or enter a replacement key." });
      return;
    }

    setIsSaving(true);
    try {
      const response = await apiRequest("PUT", "/api/settings/api-keys", {
        ...(youtubeApiKey ? { youtubeApiKey } : {}),
        ...(aiApiKey ? { aiApiKey } : {}),
        ...(clearAiKey ? { clearAiApiKey: true } : {}),
        aiBaseUrl: aiBaseUrl.trim(),
        aiTextModel: aiTextModel.trim(),
        aiImageModel: aiImageModel.trim(),
        aiImageSize: aiImageSize.trim(),
      }) as { success: boolean; status: ApiKeyStatus };

      applyStatus(response.status);
      if (youtubeKeyRef.current) youtubeKeyRef.current.value = "";
      if (aiKeyRef.current) aiKeyRef.current.value = "";
      toast({ title: "API settings saved", description: "The local server is using the updated provider settings." });
    } catch (error: any) {
      toast({ title: "Could not save settings", description: error?.message || "Check the endpoint and try again.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6 md:p-8">
      <div>
        <div className="flex items-center gap-2 text-primary"><KeyRound className="h-5 w-5" /><span className="text-sm font-medium">Local connections</span></div>
        <h1 className="mt-2 text-3xl font-bold">Settings</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Connect YouTube public data and any OpenAI-compatible AI endpoint, including local llama.cpp and LocalAI servers.</p>
      </div>

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Stored locally</AlertTitle>
        <AlertDescription>
          Keys are written to the server's ignored <code>.env</code> file with owner-only permissions. Saved secrets are never returned to the browser. Settings changes are accepted only from this machine.
        </AlertDescription>
      </Alert>

      {loadError && <Alert variant="destructive"><AlertTitle>Settings unavailable</AlertTitle><AlertDescription>{loadError}</AlertDescription></Alert>}

      <Card>
        <CardHeader>
          <CardTitle>API connections</CardTitle>
          <CardDescription>Use a local endpoint for zero AI API cost, or point the same interface at OpenAI or another compatible service.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex min-h-48 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading connection status</div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <KeyField
                id="youtube-api-key"
                label="YouTube Data API"
                description="Used for official public search, video statistics, and channel metadata. Repeated searches are cached server-side to conserve quota."
                configured={status.youtube}
                inputRef={youtubeKeyRef}
                providerUrl="https://console.cloud.google.com/apis/credentials"
                providerLabel="Open Google Cloud credentials"
              />

              <div className="space-y-4 rounded-lg border border-border bg-background/50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Label className="text-base">OpenAI-compatible AI</Label>
                    <p className="mt-1 text-sm text-muted-foreground">Text uses <code>/chat/completions</code>. Thumbnail generation uses <code>/images/generations</code> when the server supports it.</p>
                  </div>
                  <div className="flex gap-2">
                    {status.ai.localEndpoint && <Badge variant="outline" className="border-green-500/40 bg-green-500/10 text-green-500">Local endpoint</Badge>}
                    {status.ai.apiKeyConfigured && <Badge variant="outline">Key saved</Badge>}
                  </div>
                </div>

                {status.ai.legacyGeminiConfig && (
                  <Alert>
                    <AlertTitle>Legacy Gemini settings detected</AlertTitle>
                    <AlertDescription>Your existing GEMINI_* variables are being mapped through Gemini's OpenAI-compatible endpoint. Saving this form migrates the active configuration to AI_* variables.</AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="ai-base-url">Base URL</Label>
                    <Input id="ai-base-url" value={aiBaseUrl} onChange={(event) => setAiBaseUrl(event.target.value)} placeholder="http://127.0.0.1:8080/v1" className="font-mono" data-testid="input-ai-base-url" />
                    <p className="text-xs text-muted-foreground">Examples: <code>http://127.0.0.1:8080/v1</code> for llama.cpp/LocalAI or <code>https://api.openai.com/v1</code>.</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ai-text-model">Text model ID</Label>
                    <Input id="ai-text-model" value={aiTextModel} onChange={(event) => setAiTextModel(event.target.value)} placeholder="local-model" className="font-mono" data-testid="input-ai-text-model" />
                    <p className="text-xs text-muted-foreground">Exact provider model ID. llama.cpp generally serves one loaded model.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ai-image-model">Image model ID (optional)</Label>
                    <Input id="ai-image-model" value={aiImageModel} onChange={(event) => setAiImageModel(event.target.value)} placeholder="Leave blank for text-only" className="font-mono" data-testid="input-ai-image-model" />
                    <p className="text-xs text-muted-foreground">Leave blank when the endpoint does not implement OpenAI-compatible image generation.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ai-image-size">Image size</Label>
                    <Input id="ai-image-size" value={aiImageSize} onChange={(event) => setAiImageSize(event.target.value)} placeholder="1536x1024" className="font-mono" data-testid="input-ai-image-size" />
                    <p className="text-xs text-muted-foreground">Provider-specific <code>WIDTHxHEIGHT</code> or <code>auto</code>.</p>
                  </div>
                </div>

                <KeyField
                  id="ai-api-key"
                  label="AI API key"
                  description="Optional for local servers. Required only when your configured endpoint enforces authentication."
                  configured={status.ai.apiKeyConfigured}
                  inputRef={aiKeyRef}
                >
                  {status.ai.apiKeyConfigured && (
                    <div className="flex items-center gap-2">
                      <Checkbox id="clear-ai-api-key" checked={clearAiKey} onCheckedChange={(checked) => setClearAiKey(checked === true)} />
                      <Label htmlFor="clear-ai-api-key" className="text-sm font-normal">Clear the saved AI API key when saving</Label>
                    </div>
                  )}
                </KeyField>

                <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                  <a href="https://github.com/ggml-org/llama.cpp/tree/master/tools/server" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">llama.cpp server<ExternalLink className="h-3.5 w-3.5" /></a>
                  <a href="https://localai.io" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">LocalAI<ExternalLink className="h-3.5 w-3.5" /></a>
                  <a href="https://platform.openai.com/docs/api-reference" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">OpenAI API<ExternalLink className="h-3.5 w-3.5" /></a>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={isSaving || Boolean(loadError)} data-testid="button-save-api-settings">
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save and apply
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card aria-labelledby="community-heading">
        <CardHeader><CardTitle id="community-heading" className="text-lg">Join the community</CardTitle><CardDescription>Connect with AI marketers, share what you learn, and get support.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {COMMUNITIES.map((community) => (
            <a key={community.url} href={community.url} target="_blank" rel="noopener noreferrer" aria-label={`Join ${community.title}, ${community.tier}`} className="group flex min-w-0 items-center gap-3 rounded-lg border border-border bg-background/50 p-3 transition-colors hover:border-primary/40 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`link-community-${community.id}`}>
              <CommunityMark colors={community.colors} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{community.title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{community.tier}</span></span>
              <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
            </a>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
