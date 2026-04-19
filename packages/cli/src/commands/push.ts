import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import type { PackedIndex } from '@codebase-analysis/shared';

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

async function jsonPost(
  url: string,
  body: unknown,
  token: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

async function jsonPut(
  url: string,
  body: unknown,
  token: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

async function binaryPut(
  url: string,
  buf: Buffer,
  token: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` },
    body: buf,
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

async function patchStatus(
  url: string,
  body: { status: 'ready' | 'failed'; file_count?: number },
  token: string,
): Promise<void> {
  try {
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    // best-effort
  }
}

export function registerPushCommand(program: Command): void {
  program
    .command('push [path]')
    .description('Upload .codebase-analysis/index.json + source.zip to the server via HTTP')
    .option('--server <url>', 'Server base URL', process.env.ANALYZE_SERVER_URL)
    .option('--in <dir>', 'Input directory containing index.json and source.zip', '.codebase-analysis')
    .action(async (pathArg: string | undefined, opts: { server?: string; in: string }) => {
      const token = process.env.ANALYZE_UPLOAD_TOKEN;
      if (!token) {
        console.error('Error: ANALYZE_UPLOAD_TOKEN environment variable is not set.');
        process.exit(1);
      }

      const serverUrl = opts.server;
      if (!serverUrl) {
        console.error('Error: server URL is required. Use --server <url> or set ANALYZE_SERVER_URL.');
        process.exit(1);
      }

      const inDir = resolve(pathArg ?? '.', opts.in);
      const indexJsonPath = join(inDir, 'index.json');
      const sourceZipPath = join(inDir, 'source.zip');

      let indexJson: PackedIndex;
      try {
        indexJson = readJson<PackedIndex>(indexJsonPath);
      } catch (e) {
        console.error(`Error: could not read ${indexJsonPath}: ${(e as Error).message}`);
        process.exit(1);
      }

      if (indexJson.schema_version !== 1) {
        console.error(`Error: unsupported schema_version ${indexJson.schema_version} in index.json`);
        process.exit(1);
      }

      let zipBuf: Buffer;
      try {
        zipBuf = readFileSync(sourceZipPath);
      } catch (e) {
        console.error(`Error: could not read ${sourceZipPath}: ${(e as Error).message}`);
        process.exit(1);
      }

      const base = serverUrl.replace(/\/$/, '');

      // Step 1: create / reset index
      const createResult = await jsonPost(
        `${base}/v1/repos/${encodeURIComponent(indexJson.repo_name)}/indexes`,
        { commit_sha: indexJson.commit_sha, branch: indexJson.branch },
        token,
      );

      if (createResult.status === 409) {
        console.log(`Index for ${indexJson.repo_name}@${indexJson.commit_sha} already ready — skipping push.`);
        return;
      }

      if (!createResult.ok) {
        console.error(`Error: POST /v1/repos/.../indexes failed (${createResult.status}):`, createResult.data);
        process.exit(1);
      }

      const { index_id } = createResult.data as { index_id: number };
      const patchUrl = `${base}/v1/indexes/${index_id}`;

      // Step 2: upload index.json
      const jsonRes = await jsonPut(`${base}/v1/indexes/${index_id}/index-json`, indexJson, token);
      if (!jsonRes.ok) {
        console.error(`Error: PUT /index-json failed (${jsonRes.status}):`, jsonRes.data);
        await patchStatus(patchUrl, { status: 'failed' }, token);
        process.exit(1);
      }

      // Step 3: upload source.zip
      const zipRes = await binaryPut(`${base}/v1/indexes/${index_id}/source-zip`, zipBuf, token);
      if (!zipRes.ok) {
        console.error(`Error: PUT /source-zip failed (${zipRes.status}):`, zipRes.data);
        await patchStatus(patchUrl, { status: 'failed' }, token);
        process.exit(1);
      }

      // Step 4: mark ready
      const patchRes = await fetch(patchUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'ready', file_count: indexJson.files.length }),
      });

      if (!patchRes.ok) {
        console.error(`Error: PATCH /indexes/${index_id} failed (${patchRes.status})`);
        process.exit(1);
      }

      console.log(
        `Pushed ${indexJson.symbols.length} symbols from ${indexJson.files.length} files → ${serverUrl} (index_id=${index_id})`,
      );
    });
}
