import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text();
  if (text) {
    try {
      const payload = JSON.parse(text) as Record<string, unknown>;
      if (typeof payload.suggestion === "string" && payload.suggestion.trim()) return payload.suggestion;
      if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
      if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
    } catch {
      return text;
    }
    return text;
  }
  return res.statusText || `Request failed with status ${res.status}`;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) throw new Error(await readErrorMessage(res));
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<unknown> {
  const headers: Record<string, string> = {};

  if (data !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data !== undefined ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (res.status === 401) {
      if (unauthorizedBehavior === "returnNull") return null;
      throw new Error("Unauthorized request.");
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
