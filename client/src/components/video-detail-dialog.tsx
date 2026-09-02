import { useEffect, useState } from "react";
import type { Video } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  MessageSquare,
  Tag,
  ThumbsUp,
} from "lucide-react";

interface VideoDetailDialogProps {
  video: Video | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface TranscriptResponse {
  videoId: string;
  language: string;
  source: "yt-dlp";
  text: string;
  segments: Array<{ startSeconds: number; durationSeconds: number; text: string }>;
}

function formatViews(views?: number): string {
  if (views === undefined) return "N/A";
  if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
  if (views >= 1000) return `${(views / 1000).toFixed(1)}K`;
  return views.toString();
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatDuration(duration?: string): string {
  if (!duration) return "N/A";
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return duration;

  const hours = match[1] ? parseInt(match[1]) : 0;
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const seconds = match[3] ? parseInt(match[3]) : 0;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function defaultTranscriptLanguage(video: Video): string {
  const candidate = (video.defaultAudioLanguage || video.defaultLanguage || "en").trim();
  return /^[A-Za-z0-9._*-]{1,32}$/.test(candidate) ? candidate : "en";
}

export function VideoDetailDialog({ video, open, onOpenChange }: VideoDetailDialogProps) {
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [transcriptLanguage, setTranscriptLanguage] = useState("en");
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setTranscript(null);
    setTranscriptLanguage(video ? defaultTranscriptLanguage(video) : "en");
    setIsLoadingTranscript(false);
  }, [video?.id]);

  if (!video) return null;

  const youtubeUrl = `https://www.youtube.com/watch?v=${video.id}`;
  const channelUrl = `https://www.youtube.com/channel/${video.channelId}`;
  const engagementRate = video.viewCount && video.likeCount !== undefined && video.commentCount !== undefined
    ? ((video.likeCount + video.commentCount) / video.viewCount) * 100
    : null;

  const loadTranscript = async () => {
    setIsLoadingTranscript(true);
    try {
      const response = await fetch(`/api/youtube/transcript/${encodeURIComponent(video.id)}?language=${encodeURIComponent(transcriptLanguage || "en")}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.suggestion || "Transcript unavailable.");
      setTranscript(data as TranscriptResponse);
      toast({ title: "Transcript loaded", description: `${(data as TranscriptResponse).segments.length} caption segments from local yt-dlp.` });
    } catch (error: any) {
      setTranscript(null);
      toast({
        title: "Transcript unavailable",
        description: error?.message || "Install yt-dlp locally or try another caption language.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingTranscript(false);
    }
  };

  const copyTranscript = async () => {
    if (!transcript?.text) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable in this browser context.");
      }
      await navigator.clipboard.writeText(transcript.text);
      toast({ title: "Transcript copied", description: "The transcript is ready to paste into notes, prompts, or your script workflow." });
    } catch (error) {
      toast({
        title: "Could not copy transcript",
        description: error instanceof Error ? error.message : "Select the transcript text and copy it manually.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-8 text-xl leading-tight" data-testid="text-dialog-title">
            {video.title}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-6">
            <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
              <img src={video.thumbnailUrl} alt={video.title} className="h-full w-full object-cover" />
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <a className="font-medium text-foreground hover:text-primary" href={channelUrl} target="_blank" rel="noopener noreferrer">
                    {video.channelTitle}
                  </a>
                  {video.channelStatistics?.subscriberCount !== undefined && (
                    <p className="text-xs text-muted-foreground">{formatViews(video.channelStatistics.subscriberCount)} subscribers</p>
                  )}
                </div>
                <Button asChild variant="outline" size="sm">
                  <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" data-testid="link-watch-youtube">
                    <ExternalLink className="mr-2 h-4 w-4" />Watch on YouTube
                  </a>
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="flex flex-col items-center rounded-lg bg-muted/50 p-3"><Eye className="mb-1 h-5 w-5 text-muted-foreground" /><span className="text-lg font-semibold">{formatViews(video.viewCount)}</span><span className="text-xs text-muted-foreground">Views</span></div>
                <div className="flex flex-col items-center rounded-lg bg-muted/50 p-3"><ThumbsUp className="mb-1 h-5 w-5 text-muted-foreground" /><span className="text-lg font-semibold">{formatViews(video.likeCount)}</span><span className="text-xs text-muted-foreground">Likes</span></div>
                <div className="flex flex-col items-center rounded-lg bg-muted/50 p-3"><MessageSquare className="mb-1 h-5 w-5 text-muted-foreground" /><span className="text-lg font-semibold">{formatViews(video.commentCount)}</span><span className="text-xs text-muted-foreground">Comments</span></div>
                <div className="flex flex-col items-center rounded-lg bg-muted/50 p-3"><Clock className="mb-1 h-5 w-5 text-muted-foreground" /><span className="text-lg font-semibold">{formatDuration(video.duration)}</span><span className="text-xs text-muted-foreground">Duration</span></div>
              </div>

              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Calendar className="h-4 w-4" /><span>Published on {formatDate(video.publishedAt)}</span></div>

              <div className="flex flex-wrap gap-2">
                {engagementRate !== null && <Badge variant="outline">{engagementRate.toFixed(2)}% public engagement</Badge>}
                {video.definition && <Badge variant="secondary">{video.definition.toUpperCase()}</Badge>}
                {video.hasCaptions !== undefined && <Badge variant="secondary">{video.hasCaptions ? "Captions" : "No captions"}</Badge>}
                {(video.defaultAudioLanguage || video.defaultLanguage) && <Badge variant="secondary">{video.defaultAudioLanguage || video.defaultLanguage}</Badge>}
                {video.hasPaidProductPlacement && <Badge variant="outline">Paid promotion disclosed</Badge>}
              </div>

              {video.description && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Description</h4>
                  <p className="line-clamp-6 whitespace-pre-wrap text-sm text-muted-foreground">{video.description}</p>
                </div>
              )}

              {video.tags && video.tags.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2"><Tag className="h-4 w-4 text-muted-foreground" /><h4 className="text-sm font-medium">Tags</h4></div>
                  <div className="flex flex-wrap gap-2">
                    {video.tags.slice(0, 10).map((tag, index) => <Badge key={index} variant="secondary" className="text-xs">{tag}</Badge>)}
                    {video.tags.length > 10 && <Badge variant="outline" className="text-xs">+{video.tags.length - 10} more</Badge>}
                  </div>
                </div>
              )}

              <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /><h4 className="text-sm font-medium">Transcript</h4></div>
                    <p className="mt-1 text-xs text-muted-foreground">Fetch creator captions or automatic captions locally with yt-dlp. Video media is not downloaded.</p>
                  </div>
                  {transcript && <Badge variant="outline">{transcript.language} · {transcript.segments.length} segments</Badge>}
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-32 flex-1 space-y-1">
                    <Label htmlFor="transcript-language" className="text-xs">Caption language</Label>
                    <Input id="transcript-language" value={transcriptLanguage} onChange={(event) => setTranscriptLanguage(event.target.value)} placeholder="en" className="h-8 font-mono text-xs" />
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={loadTranscript} disabled={isLoadingTranscript}>
                    {isLoadingTranscript ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                    {transcript ? "Reload transcript" : "Load transcript"}
                  </Button>
                  {transcript && (
                    <Button type="button" size="sm" variant="outline" onClick={copyTranscript}>
                      <Copy className="mr-2 h-4 w-4" />Copy
                    </Button>
                  )}
                </div>

                {transcript && (
                  <div className="max-h-64 overflow-y-auto rounded-md border border-border/70 bg-background/70 p-3 text-sm leading-relaxed text-muted-foreground">
                    {transcript.text}
                  </div>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
