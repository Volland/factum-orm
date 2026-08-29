/**
 * A minimal DOM good enough for the SVG renderer: elements with attributes and
 * children. It lets the diagram rendering be tested in plain Node.
 */
export interface StubNode {
  tag: string;
  attrs: Record<string, string>;
  children: StubNode[];
  text?: string;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  append(...nodes: (StubNode | string)[]): void;
}

function createNode(tag: string): StubNode {
  const node: StubNode = {
    tag,
    attrs: {},
    children: [],
    setAttribute(name, value) {
      node.attrs[name] = value;
    },
    getAttribute(name) {
      return node.attrs[name] ?? null;
    },
    append(...nodes) {
      for (const child of nodes) {
        node.children.push(typeof child === 'string' ? { ...createNode('#text'), text: child } : child);
      }
    },
  };
  return node;
}

export function installDomShim(): void {
  (globalThis as unknown as { document: unknown }).document = {
    createElementNS: (_ns: string, tag: string) => createNode(tag),
    createTextNode: (text: string) => ({ ...createNode('#text'), text }),
  };
}

/** Depth-first walk over a rendered tree. */
export function walk(node: StubNode, visit: (node: StubNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

export function countByClass(root: StubNode, className: string): number {
  let count = 0;
  walk(root, (node) => {
    const classes = (node.attrs.class ?? '').split(/\s+/);
    if (classes.includes(className)) count += 1;
  });
  return count;
}

export function textsOf(root: StubNode): string[] {
  const texts: string[] = [];
  walk(root, (node) => {
    if (node.tag === '#text' && node.text) texts.push(node.text);
  });
  return texts;
}
