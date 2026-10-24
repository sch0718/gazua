// 도움말 문구의 표시: `단추 이름`은 단추 모양, **강조**는 굵게, [글](https://…)은 새 창 링크.
// 문구는 생성 파일(content.ts)에서만 오지만, 링크는 https만 살린다.

export type HelpTextPart =
  | { kind: 'text' | 'key' | 'strong'; text: string }
  | { kind: 'link'; text: string; href: string };

const TOKEN = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/g;

export function parseHelpText(s: string): HelpTextPart[] {
  const parts: HelpTextPart[] = [];
  const push = (p: HelpTextPart) => {
    const last = parts.at(-1);
    if (p.kind === 'text' && last?.kind === 'text') last.text += p.text;
    else if (p.text !== '') parts.push(p);
  };
  let at = 0;
  for (const m of s.matchAll(TOKEN)) {
    push({ kind: 'text', text: s.slice(at, m.index) });
    if (m[1] !== undefined) push({ kind: 'key', text: m[1] });
    else if (m[2] !== undefined) push({ kind: 'strong', text: m[2] });
    else if (/^https:\/\//.test(m[4])) push({ kind: 'link', text: m[3], href: m[4] });
    else push({ kind: 'text', text: m[3] });
    at = m.index + m[0].length;
  }
  push({ kind: 'text', text: s.slice(at) });
  return parts;
}
