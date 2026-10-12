/**
 * Minimal XML tree builder. Element order is whatever the caller writes, so
 * every message module is covered by a test that validates against the XSD.
 */
export type Node = { name: string; attrs?: Record<string, string>; children?: Node[]; text?: string };

export function el(name: string, content?: Node[] | string | null, attrs?: Record<string, string>): Node {
  if (content == null) return { name, attrs, children: [] };
  return typeof content === 'string' ? { name, attrs, text: content } : { name, attrs, children: content };
}

/** Drops null/undefined/false entries so optional elements can be written inline. */
export function opt(...nodes: Array<Node | Node[] | null | undefined | false>): Node[] {
  return nodes.flat().filter((n): n is Node => Boolean(n));
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function render(node: Node, depth: number): string {
  const pad = '  '.repeat(depth);
  const attrs = Object.entries(node.attrs ?? {}).map(([k, v]) => ` ${k}="${escape(v)}"`).join('');
  if (node.text !== undefined) return `${pad}<${node.name}${attrs}>${escape(node.text)}</${node.name}>`;
  const kids = node.children ?? [];
  if (kids.length === 0) return `${pad}<${node.name}${attrs}/>`;
  return `${pad}<${node.name}${attrs}>\n${kids.map((k) => render(k, depth + 1)).join('\n')}\n${pad}</${node.name}>`;
}

export function documentXml(namespace: string, root: Node): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${render(el('Document', [root], { xmlns: namespace }), 0)}\n`;
}
