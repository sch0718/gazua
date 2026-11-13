import { runAuto } from '../auto/run';
import type { Command } from '../context';
import { CliError } from '../errors';

export const auto: Command = async (ctx) => {
  if (ctx.args.positionals.length || ctx.args.yes) throw new CliError('invalid-args', 'auto는 위치 인자와 --yes를 받지 않아요');
  return runAuto(ctx);
};
