import { FormEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import {
  BrainCircuit,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Wifi,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ProviderStatus {
  apiKeyConfigured: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  localEndpoint: boolean;
}

interface ApiKeyStatus {
  youtube: boolean;
  ai: {
    legacyGeminiConfig: boolean;
    text: ProviderStatus;
    image: ProviderStatus & { imageSize: string };
  };
}

interface SecretFieldProps {
  id: string;
  label: string;
  description: string;
  configured: boolean;
  inputRef: RefObject<HTMLInputElement>;
  clearChecked: boolean;
  onClearChange: (checked: boolean) => void;
  providerUrl?: string;
  providerLabel?: string;
  children?: ReactNode;
}

interface ModelDiscoveryState {
  loading: boolean;
  models: string[];
  error: string | null;
}

const DEFAULT_STATUS: ApiKeyStatus = {
  youtube: false,
  ai: {
    legacyGeminiConfig: false,
    text: {
      apiKeyConfigured: false,
      baseUrl: "http://127.0.0.1:8080/v1",
      model: "local-model",
      timeoutMs: 120000,
      localEndpoint: true,
    },
    image: {
      apiKeyConfigured: false,
      baseUrl: "http://127.0.0.1:8080/v1",
      model: "",
      imageSize: "1536x1024",
      timeoutMs: 300000,
      localEndpoint: true,
    },
  },
};

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

function SecretField({
  id,
  label,
  description,
  configured,
  inputRef,
  clearChecked,
  onClearChange,
  providerUrl,
  providerLabel,
  children,
}: SecretFieldProps) {
  const [showKey, setShowKey] = useState(false);
  return (
    <div className="space-y-3 rounded-lg border border-border/80 bg-background/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Badge variant="outline" className={configured ? "border-green-500/40 bg-green-500/10 text-green-500" : "text-muted-foreground"}>
          {configured ? "Key saved" : "No key"}
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
          placeholder={configured ? "Leave blank to keep saved key" : "Optional for keyless local servers"}
          className="pr-11 font-mono"
          data-testid={`input-${id}`}
          disabled={clearChecked}
        />
        <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => setShowKey((visible) => !visible)} aria-label={showKey ? `Hide ${label}` : `Show ${label}`} disabled={clearChecked}>
          {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
      {configured && (
        <div className="flex items-center gap-2">
          <Checkbox id={`clear-${id}`} checked={clearChecked} onCheckedChange={(checked) => onClearChange(checked === true)} />
          <Label htmlFor={`clear-${id}`} className="text-xs font-normal text-muted-foreground">Clear the saved key when saving</Label>
        </div>
      )}
      {children}
      {providerUrl && providerLabel && (
        <a href={providerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          {providerLabel}<ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

async function postSettingsJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const suggestion = typeof data.suggestion === "string" ? data.suggestion : "";
    const message = typeof data.error === "string" ? data.error : "Request failed.";
    throw new Error(suggestion || message);
  }
  return data as T;
}

function ModelChoices({ models, activeModel, onChoose }: { models: string[]; activeModel: string; onChoose: (model: string) => void }) {
  if (models.length === 0) return null;
  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-muted/15 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">Models reported by <code>/models</code></p>
        <Badge variant="secondary">{models.length}</Badge>
      </div>
      <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
        {models.map((model) => (
          <Button
            key={model}
            type="button"
            size="sm"
            variant={model === activeModel ? "default" : "outline"}
            className="h-7 max-w-full font-mono text-xs"
            onClick={() => onChoose(model)}
            title={model}
          >
            <span className="truncate">{model}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [status, setStatus] = useState<ApiKeyStatus>(DEFAULT_STATUS);
  const [textBaseUrl, setTextBaseUrl] = useState(DEFAULT_STATUS.ai.text.baseUrl);
  const [textModel, setTextModel] = useState(DEFAULT_STATUS.ai.text.model);
  const [textTimeoutMs, setTextTimeoutMs] = useState(String(DEFAULT_STATUS.ai.text.timeoutMs));
  const [imageBaseUrl, setImageBaseUrl] = useState(DEFAULT_STATUS.ai.image.baseUrl);
  const [imageModel, setImageModel] = useState(DEFAULT_STATUS.ai.image.model);
  const [imageSize, setImageSize] = useState(DEFAULT_STATUS.ai.image.imageSize);
  const [imageTimeoutMs, setImageTimeoutMs] = useState(String(DEFAULT_STATUS.ai.image.timeoutMs));
  const [clearYoutubeKey, setClearYoutubeKey] = useState(false);
  const [clearTextKey, setClearTextKey] = useState(false);
  const [clearImageKey, setClearImageKey] = useState(false);
  const [textDiscovery, setTextDiscovery] = useState<ModelDiscoveryState>({ loading: false, models: [], error: null });
  const [imageDiscovery, setImageDiscovery] = useState<ModelDiscoveryState>({ loading: false, models: [], error: null });
  const [testingText, setTestingText] = useState(false);
  const [textTestResult, setTextTestResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const youtubeKeyRef = useRef<HTMLInputElement>(null);
  const textKeyRef = useRef<HTMLInputElement>(null);
  const imageKeyRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const applyStatus = (nextStatus: ApiKeyStatus) => {
    setStatus(nextStatus);
    setTextBaseUrl(nextStatus.ai.text.baseUrl);
    setTextModel(nextStatus.ai.text.model);
    setTextTimeoutMs(String(nextStatus.ai.text.timeoutMs));
    setImageBaseUrl(nextStatus.ai.image.baseUrl);
    setImageModel(nextStatus.ai.image.model);
    setImageSize(nextStatus.ai.image.imageSize);
    setImageTimeoutMs(String(nextStatus.ai.image.timeoutMs));
    setClearYoutubeKey(false);
    setClearTextKey(false);
    setClearImageKey(false);
    setTextTestResult(null);
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
    void loadStatus();
  }, []);

  const buildProbeBody = (kind: "text" | "image") => {
    const isText = kind === "text";
    const keyValue = (isText ? textKeyRef.current?.value : imageKeyRef.current?.value)?.trim() || "";
    const clearKey = isText ? clearTextKey : clearImageKey;
    return {
      kind,
      baseUrl: (isText ? textBaseUrl : imageBaseUrl).trim(),
      ...(clearKey ? { apiKey: "" } : keyValue ? { apiKey: keyValue } : {}),
      ...(isText ? { model: textModel.trim(), timeoutMs: Number(textTimeoutMs) } : { timeoutMs: Number(imageTimeoutMs) }),
    };
  };

  const discoverModels = async (kind: "text" | "image") => {
    const setDiscovery = kind === "text" ? setTextDiscovery : setImageDiscovery;
    setDiscovery((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await postSettingsJson<{ models: string[] }>("/api/settings/ai/models", buildProbeBody(kind));
      setDiscovery({ loading: false, models: result.models, error: result.models.length ? null : "The endpoint responded but returned no model IDs." });
    } catch (error: any) {
      setDiscovery({ loading: false, models: [], error: error?.message || "Model discovery failed." });
    }
  };

  const testTextConnection = async () => {
    setTestingText(true);
    setTextTestResult(null);
    try {
      const result = await postSettingsJson<{ model: string; latencyMs: number; responsePreview: string }>("/api/settings/ai/test", buildProbeBody("text"));
      setTextTestResult(`${result.model} responded in ${result.latencyMs.toLocaleString()} ms: ${result.responsePreview}`);
    } catch (error: any) {
      setTextTestResult(error?.message || "Connection test failed.");
    } finally {
      setTestingText(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const youtubeApiKey = clearYoutubeKey ? "" : youtubeKeyRef.current?.value.trim() || "";
    const aiTextApiKey = clearTextKey ? "" : textKeyRef.current?.value.trim() || "";
    const aiImageApiKey = clearImageKey ? "" : imageKeyRef.current?.value.trim() || "";
    const textTimeout = Number(textTimeoutMs);
    const imageTimeout = Number(imageTimeoutMs);

    if (!Number.isInteger(textTimeout) || textTimeout < 1000 || textTimeout > 1800000) {
      toast({ title: "Invalid LLM timeout", description: "Use a whole number from 1000 to 1800000 milliseconds.", variant: "destructive" });
      return;
    }
    if (!Number.isInteger(imageTimeout) || imageTimeout < 1000 || imageTimeout > 1800000) {
      toast({ title: "Invalid image timeout", description: "Use a whole number from 1000 to 1800000 milliseconds.", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      const response = await apiRequest("PUT", "/api/settings/api-keys", {
        ...(youtubeApiKey ? { youtubeApiKey } : {}),
        ...(clearYoutubeKey ? { clearYoutubeApiKey: true } : {}),
        ...(aiTextApiKey ? { aiTextApiKey } : {}),
        ...(clearTextKey ? { clearAiTextApiKey: true } : {}),
        aiTextBaseUrl: textBaseUrl.trim(),
        aiTextModel: textModel.trim(),
        aiTextTimeoutMs: textTimeout,
        ...(aiImageApiKey ? { aiImageApiKey } : {}),
        ...(clearImageKey ? { clearAiImageApiKey: true } : {}),
        aiImageBaseUrl: imageBaseUrl.trim(),
        aiImageModel: imageModel.trim(),
        aiImageSize: imageSize.trim(),
        aiImageTimeoutMs: imageTimeout,
      }) as { success: boolean; status: ApiKeyStatus };

      applyStatus(response.status);
      if (youtubeKeyRef.current) youtubeKeyRef.current.value = "";
      if (textKeyRef.current) textKeyRef.current.value = "";
      if (imageKeyRef.current) imageKeyRef.current.value = "";
      toast({ title: "Connection settings saved", description: "LLM, image generation, and YouTube settings are active immediately." });
    } catch (error: any) {
      toast({ title: "Could not save settings", description: error?.message || "Check the endpoints and try again.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 md:p-8">
      <div>
        <div className="flex items-center gap-2 text-primary"><KeyRound className="h-5 w-5" /><span className="text-sm font-medium">Provider configuration</span></div>
        <h1 className="mt-2 text-3xl font-bold">Settings</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">Configure every model-facing connection from the UI. Text and image generation can use the same OpenAI-compatible server or completely different providers.</p>
      </div>

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Secrets stay server-side</AlertTitle>
        <AlertDescription>
          Keys are written to the ignored local <code>.env</code> file with owner-only permissions. Saved secrets are never returned to the browser. These controls are accepted only from a direct loopback, same-origin request.
        </AlertDescription>
      </Alert>

      {loadError && <Alert variant="destructive"><AlertTitle>Settings unavailable</AlertTitle><AlertDescription>{loadError}</AlertDescription></Alert>}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />YouTube public data</CardTitle>
            <CardDescription>Official search and public video/channel statistics. This key is independent from both AI providers.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex min-h-28 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading settings</div>
            ) : (
              <SecretField
                id="youtube-api-key"
                label="YouTube Data API key"
                description="Blank keeps the saved key. Use the clear option to remove it."
                configured={status.youtube}
                inputRef={youtubeKeyRef}
                clearChecked={clearYoutubeKey}
                onClearChange={setClearYoutubeKey}
                providerUrl="https://console.cloud.google.com/apis/credentials"
                providerLabel="Google Cloud credentials"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BrainCircuit className="h-5 w-5" />LLM / text generation</CardTitle>
            <CardDescription>Used by AI Insights, Grounded Ideas, Script Writer, regeneration, and thumbnail text suggestions through <code>/chat/completions</code>.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {isLoading ? (
              <div className="flex min-h-40 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading LLM connection</div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {status.ai.text.localEndpoint && <Badge variant="outline" className="border-green-500/40 bg-green-500/10 text-green-500">Local endpoint</Badge>}
                  <Badge variant="outline">OpenAI-compatible</Badge>
                  {status.ai.text.apiKeyConfigured && <Badge variant="secondary">Authentication saved</Badge>}
                </div>

                {status.ai.legacyGeminiConfig && (
                  <Alert>
                    <AlertTitle>Legacy Gemini configuration detected</AlertTitle>
                    <AlertDescription>Existing <code>GEMINI_*</code> variables are being mapped through Gemini's OpenAI-compatible endpoint. Saving this page migrates the active settings into the split AI configuration.</AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="ai-text-base-url">LLM API base URL</Label>
                    <Input id="ai-text-base-url" value={textBaseUrl} onChange={(event) => { setTextBaseUrl(event.target.value); setTextTestResult(null); }} placeholder="http://127.0.0.1:8080/v1" className="font-mono" data-testid="input-ai-text-base-url" />
                    <p className="text-xs text-muted-foreground">Examples: llama.cpp / LocalAI <code>http://127.0.0.1:8080/v1</code>, OpenAI <code>https://api.openai.com/v1</code>.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ai-text-model">LLM model ID</Label>
                    <Input id="ai-text-model" value={textModel} onChange={(event) => { setTextModel(event.target.value); setTextTestResult(null); }} placeholder="local-model" className="font-mono" data-testid="input-ai-text-model" />
                    <p className="text-xs text-muted-foreground">Exact provider model ID. There is no hardcoded allowlist.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ai-text-timeout">LLM timeout (ms)</Label>
                    <Input id="ai-text-timeout" type="number" min={1000} max={1800000} step={1000} value={textTimeoutMs} onChange={(event) => setTextTimeoutMs(event.target.value)} className="font-mono" data-testid="input-ai-text-timeout" />
                    <p className="text-xs text-muted-foreground">Increase this for slower local hardware or large research prompts.</p>
                  </div>
                </div>

                <SecretField
                  id="ai-text-api-key"
                  label="LLM API key"
                  description="Optional for llama.cpp/LocalAI unless authentication is enabled. Hosted providers usually require one."
                  configured={status.ai.text.apiKeyConfigured}
                  inputRef={textKeyRef}
                  clearChecked={clearTextKey}
                  onClearChange={(checked) => { setClearTextKey(checked); setTextTestResult(null); }}
                />

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => void discoverModels("text")} disabled={textDiscovery.loading}>
                    {textDiscovery.loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Discover models
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void testTextConnection()} disabled={testingText || !textModel.trim()}>
                    {testingText ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
                    Test LLM
                  </Button>
                </div>
                {textDiscovery.error && <Alert><AlertTitle>Model discovery</AlertTitle><AlertDescription>{textDiscovery.error}</AlertDescription></Alert>}
                <ModelChoices models={textDiscovery.models} activeModel={textModel} onChoose={setTextModel} />
                {textTestResult && <Alert><Sparkles className="h-4 w-4" /><AlertTitle>LLM connection test</AlertTitle><AlertDescription className="break-words">{textTestResult}</AlertDescription></Alert>}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ImageIcon className="h-5 w-5" />Image generation</CardTitle>
            <CardDescription>Used only for generated thumbnails through <code>/images/generations</code>. Leave the model blank to run YouTube Pro in text-only mode.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {isLoading ? (
              <div className="flex min-h-40 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading image connection</div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {status.ai.image.localEndpoint && <Badge variant="outline" className="border-green-500/40 bg-green-500/10 text-green-500">Local endpoint</Badge>}
                  <Badge variant="outline">OpenAI-compatible</Badge>
                  {status.ai.image.apiKeyConfigured && <Badge variant="secondary">Authentication saved</Badge>}
                  {!imageModel.trim() && <Badge variant="secondary">Image generation disabled</Badge>}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="ai-image-base-url">Image API base URL</Label>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setImageBaseUrl(textBaseUrl)}>Use LLM endpoint</Button>
                    </div>
                    <Input id="ai-image-base-url" value={imageBaseUrl} onChange={(event) => setImageBaseUrl(event.target.value)} placeholder="http://127.0.0.1:8080/v1" className="font-mono" data-testid="input-ai-image-base-url" />
                    <p className="text-xs text-muted-foreground">Can be a different server/provider from the LLM endpoint.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ai-image-model">Image model ID</Label>
                    <Input id="ai-image-model" value={imageModel} onChange={(event) => setImageModel(event.target.value)} placeholder="Blank disables generated images" className="font-mono" data-testid="input-ai-image-model" />
                    <p className="text-xs text-muted-foreground">Exact model ID accepted by the image endpoint.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ai-image-size">Image size</Label>
                    <Input id="ai-image-size" value={imageSize} onChange={(event) => setImageSize(event.target.value)} placeholder="1536x1024" className="font-mono" data-testid="input-ai-image-size" />
                    <p className="text-xs text-muted-foreground">Provider-specific <code>WIDTHxHEIGHT</code> or <code>auto</code>.</p>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="ai-image-timeout">Image request/download timeout (ms)</Label>
                    <Input id="ai-image-timeout" type="number" min={1000} max={1800000} step={1000} value={imageTimeoutMs} onChange={(event) => setImageTimeoutMs(event.target.value)} className="font-mono" data-testid="input-ai-image-timeout" />
                    <p className="text-xs text-muted-foreground">Local diffusion backends can need several minutes.</p>
                  </div>
                </div>

                <SecretField
                  id="ai-image-api-key"
                  label="Image API key"
                  description="Independent from the LLM key, so text and image providers can use different accounts or authentication."
                  configured={status.ai.image.apiKeyConfigured}
                  inputRef={imageKeyRef}
                  clearChecked={clearImageKey}
                  onClearChange={setClearImageKey}
                />

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => void discoverModels("image")} disabled={imageDiscovery.loading}>
                    {imageDiscovery.loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Discover image models
                  </Button>
                </div>
                {imageDiscovery.error && <Alert><AlertTitle>Image model discovery</AlertTitle><AlertDescription>{imageDiscovery.error}</AlertDescription></Alert>}
                <ModelChoices models={imageDiscovery.models} activeModel={imageModel} onChoose={setImageModel} />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Provider references</CardTitle>
            <CardDescription>Any server implementing the OpenAI-compatible paths can be used. Model discovery is optional because some compatible servers omit <code>/models</code>.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <a href="https://github.com/ggml-org/llama.cpp/tree/master/tools/server" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">llama.cpp server<ExternalLink className="h-3.5 w-3.5" /></a>
            <a href="https://localai.io" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">LocalAI<ExternalLink className="h-3.5 w-3.5" /></a>
            <a href="https://platform.openai.com/docs/api-reference" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">OpenAI API<ExternalLink className="h-3.5 w-3.5" /></a>
            <a href="https://ai.google.dev/gemini-api/docs/openai" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Gemini compatibility<ExternalLink className="h-3.5 w-3.5" /></a>
          </CardContent>
        </Card>

        <div className="sticky bottom-4 z-20 flex justify-end rounded-xl border border-border/80 bg-background/90 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/75">
          <Button type="submit" disabled={isSaving || Boolean(loadError) || isLoading} data-testid="button-save-api-settings">
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save and apply all connections
          </Button>
        </div>
      </form>

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
