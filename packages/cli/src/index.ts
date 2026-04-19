import { Command } from 'commander';

const program = new Command();

program
  .name('analyze')
  .description('codebase-analysis CLI')
  .version('0.0.1');

program.parse();
