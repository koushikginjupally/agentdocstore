/**
 * REST API client for the AgentDocStore server.
 * All requests go to the same origin (no external egress).
 */

// ---- Types matching the server REST contract ----

export interface ApiDocument {
  id: string;
  title: string;
  language: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  latestVersion: number;
  expiresAt?: string;
}

export interface ApiDocumentVersion {
  documentId: string;
  version: number;
  content: string;
  createdBy: string;
  createdAt: string;
  /** Editor's note for this change, when one was given. */
  message?: string;
}

export interface ApiComment {
  id: string;
  documentId: string;
  author: string;
  body: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiPage<T> {
  items: T[];
  nextCursor?: string;
}

export interface ApiWhoami {
  user: string;
}

export interface ApiScanResult {
  detected: string[];
  options: string[];
}

export interface ApiDiff {
  diff: string;
}

// ---- Error types ----

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class CredentialScanError extends ApiError {
  readonly detected: string[];
  readonly options: string[];

  constructor(body: ApiScanResult) {
    super('Credentials detected in content', 409, body);
    this.name = 'CredentialScanError';
    this.detected = body.detected;
    this.options = body.options;
  }
}

// ---- Fetch wrapper ----

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    // Read the body once: after a failed res.json() the body is spent and
    // res.text() throws, which would replace this ApiError with a TypeError.
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON (for example a proxy's error page); keep the text.
    }
    // 409 is also a version conflict ({ error }), which must not open the
    // credentials dialog: only a body that lists findings is a scan result.
    if (res.status === 409 && isScanResult(body)) throw new CredentialScanError(body);
    throw new ApiError(
      `API error ${res.status}: ${errorMessage(body) ?? res.statusText}`,
      res.status,
      body,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** True for the credential-scan 409 body, `{ detected: [...], options: [...] }`. */
function isScanResult(body: unknown): body is ApiScanResult {
  if (typeof body !== 'object' || body === null) return false;
  const { detected, options } = body as { detected?: unknown; options?: unknown };
  return Array.isArray(detected) && Array.isArray(options);
}

/** The message in a `{ "error": "<message>" }` body, the REST error shape. */
function errorMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const { error } = body as { error: unknown };
  return typeof error === 'string' && error !== '' ? error : undefined;
}

// ---- API methods ----

export const api = {
  whoami(): Promise<ApiWhoami> {
    return request('/api/whoami');
  },

  createDocument(input: {
    title: string;
    content: string;
    language: string;
    visibility?: string;
    expiresInDays?: number;
    redactionPolicy?: string;
  }): Promise<ApiDocument> {
    return request('/api/documents', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  getDocument(
    id: string,
    version?: number,
  ): Promise<ApiDocument & { content: string; version: number }> {
    const q = version != null ? `?version=${version}` : '';
    return request(`/api/documents/${encodeURIComponent(id)}${q}`);
  },

  listDocuments(query?: string, cursor?: string, limit?: number): Promise<ApiPage<ApiDocument>> {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (cursor) params.set('cursor', cursor);
    if (limit != null) params.set('limit', String(limit));
    const qs = params.toString();
    return request(`/api/documents${qs ? `?${qs}` : ''}`);
  },

  updateDocument(
    id: string,
    input: {
      content?: string;
      title?: string;
      language?: string;
      editMessage?: string;
      visibility?: string;
      expiresInDays?: number;
      redactionPolicy?: string;
    },
  ): Promise<ApiDocument> {
    return request(`/api/documents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  deleteDocument(id: string): Promise<void> {
    return request(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async getVersions(id: string): Promise<ApiDocumentVersion[]> {
    // The server wraps lists in an envelope: { versions: [...] }.
    const body = await request<{ versions: ApiDocumentVersion[] }>(
      `/api/documents/${encodeURIComponent(id)}/versions`,
    );
    return body.versions;
  },

  getDiff(id: string, from: number, to: number): Promise<ApiDiff> {
    return request(`/api/documents/${encodeURIComponent(id)}/diff?from=${from}&to=${to}`);
  },

  getRawUrl(id: string, version?: number): string {
    const q = version != null ? `?version=${version}` : '';
    return `/raw/${encodeURIComponent(id)}${q}`;
  },

  addComment(documentId: string, body: string): Promise<ApiComment> {
    return request(`/api/documents/${encodeURIComponent(documentId)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  },

  async getComments(documentId: string): Promise<ApiComment[]> {
    // The server wraps lists in an envelope: { comments: [...] }.
    const body = await request<{ comments: ApiComment[] }>(
      `/api/documents/${encodeURIComponent(documentId)}/comments`,
    );
    return body.comments;
  },

  resolveComment(documentId: string, commentId: string, resolved: boolean): Promise<ApiComment> {
    return request(
      `/api/documents/${encodeURIComponent(documentId)}/comments/${encodeURIComponent(commentId)}`,
      { method: 'PATCH', body: JSON.stringify({ resolved }) },
    );
  },

  deleteComment(documentId: string, commentId: string): Promise<void> {
    return request(
      `/api/documents/${encodeURIComponent(documentId)}/comments/${encodeURIComponent(commentId)}`,
      { method: 'DELETE' },
    );
  },

  setVisibility(documentId: string, visibility: string): Promise<ApiDocument> {
    return request(`/api/documents/${encodeURIComponent(documentId)}/visibility`, {
      method: 'POST',
      body: JSON.stringify({ visibility }),
    });
  },

  async scanContent(content: string): Promise<{ detected: string[] }> {
    // /api/scan returns { findings: [{ type, line, start, end }] }; expose the
    // distinct types in the same `detected` shape the 409 credential flow uses.
    const body = await request<{ findings: Array<{ type: string }> }>('/api/scan', {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    return { detected: [...new Set(body.findings.map((f) => f.type))] };
  },
};

/**
 * The signed-in user's name, or `null` when it cannot be determined. Never
 * rejects: pages treat `null` as "not the owner" and hide owner-only actions
 * (fail closed). The server enforces every rule regardless.
 */
export function resolveViewer(): Promise<string | null> {
  return api.whoami().then(
    (w) => w.user,
    () => null,
  );
}
