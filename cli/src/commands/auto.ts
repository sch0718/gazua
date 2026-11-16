import { runDigest } from '../auto/digest';
import { runAuto } from '../auto/run';
import type { Command } from '../context';
import { CliError } from '../errors';

export const auto: Command = async (ctx) => {
  if (ctx.args.yes) throw new CliError('invalid-args', 'auto는 --yes를 받지 않아요');
  if (ctx.args.positionals.length === 1 && ctx.args.positionals[0] === 'digest') return runDigest(ctx);
  if (ctx.args.positionals.length) throw new CliError('invalid-args', 'auto는 digest 외의 위치 인자를 받지 않아요');
  return runAuto(ctx);
};
