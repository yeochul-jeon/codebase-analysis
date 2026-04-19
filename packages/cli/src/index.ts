import { Command } from 'commander';
import { registerAnalyzeCommand } from './commands/analyze.js';
import { registerPushCommand } from './commands/push.js';

const program = new Command();

program
  .name('analyze')
  .description('codebase-analysis CLI')
  .version('0.0.1');

registerAnalyzeCommand(program);
registerPushCommand(program);

program.parse();
