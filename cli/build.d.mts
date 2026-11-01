export const FORBIDDEN: string[];
export function findForbidden(text: string): string[];
export function bundle(outfile?: string, env?: Record<string, string | undefined>): Promise<string>;
