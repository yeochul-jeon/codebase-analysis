import { createHash } from 'node:crypto';

export function computeSymbolKey(args: {
  repoName: string;
  commitSha: string;
  filePath: string;
  name: string;
  kind: string;
  startLine: number;
}): string {
  return createHash('sha256')
    .update(`${args.repoName}\0${args.commitSha}\0${args.filePath}\0${args.name}\0${args.kind}\0${args.startLine}`)
    .digest('hex');
}
