export interface SearchParams {
  q: string;
  repo: string;
  commit?: string;
  limit?: number;
}

export interface FileSymbolsParams {
  repo: string;
  path: string;
  commit?: string;
}

export class ServerClient {
  private base: string;
  private fetchImpl: typeof fetch;

  constructor(baseUrl: string, opts?: { fetchImpl?: typeof fetch }) {
    this.base = baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts?.fetchImpl ?? globalThis.fetch;
  }

  async search(params: SearchParams): Promise<unknown> {
    const qs = new URLSearchParams({ q: params.q, repo: params.repo });
    if (params.commit) qs.set('commit', params.commit);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    const res = await this.fetchImpl(`${this.base}/v1/search?${qs}`);
    return this.parseResponse(res);
  }

  async getSymbolBody(key: string): Promise<unknown> {
    const res = await this.fetchImpl(`${this.base}/v1/symbols/${encodeURIComponent(key)}/body`);
    return this.parseResponse(res);
  }

  async getReferences(key: string): Promise<unknown> {
    const res = await this.fetchImpl(`${this.base}/v1/symbols/${encodeURIComponent(key)}/references`);
    return this.parseResponse(res);
  }

  async getFileSymbols(params: FileSymbolsParams): Promise<unknown> {
    const qs = new URLSearchParams({ path: params.path });
    if (params.commit) qs.set('commit', params.commit);
    const res = await this.fetchImpl(`${this.base}/v1/repos/${encodeURIComponent(params.repo)}/file-symbols?${qs}`);
    return this.parseResponse(res);
  }

  private async parseResponse(res: Response): Promise<unknown> {
    const body = await res.json().catch(() => ({})) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
  }
}
