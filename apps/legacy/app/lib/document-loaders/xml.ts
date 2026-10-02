import { DOMParser as XmldomParser } from "@xmldom/xmldom";

type ParserLike = {
  parseFromString(source: string, mimeType: string): Document;
};

export function parseXml(source: string): XMLDocument {
  const parser =
    typeof DOMParser === "undefined"
      ? (new XmldomParser() as unknown as ParserLike)
      : (new DOMParser() as ParserLike);
  const doc = parser.parseFromString(source, "application/xml") as XMLDocument;
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error("Malformed XML document.");
  }
  return doc;
}

export function attr(element: Element, ...names: string[]): string | null {
  for (const name of names) {
    const direct = element.getAttribute(name);
    if (direct !== null) return direct;
  }

  const localNames = new Set(names.map((name) => name.split(":").pop()));
  for (let i = 0; i < element.attributes.length; i += 1) {
    const item = element.attributes.item(i);
    if (!item) continue;
    if (localNames.has(item.localName)) return item.value;
  }

  return null;
}

export function localNameOf(node: Element): string {
  return node.localName || node.tagName.split(":").pop() || node.tagName;
}

export function descendantsByLocalName(
  root: Node,
  localName: string,
): Element[] {
  return descendantElements(root).filter(
    (element) => localNameOf(element) === localName,
  );
}

export function descendantElements(root: Node): Element[] {
  const out: Element[] = [];
  for (const child of childElements(root)) {
    out.push(child);
    out.push(...descendantElements(child));
  }
  return out;
}

export function childrenByLocalName(
  root: Node,
  localName: string,
): Element[] {
  return childElements(root).filter(
    (element) => localNameOf(element) === localName,
  );
}

export function firstDescendantText(
  root: Node,
  localName: string,
): string {
  return cleanText(descendantsByLocalName(root, localName)[0]?.textContent ?? "");
}

export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function childElements(root: Node): Element[] {
  const children: Element[] = [];
  for (let i = 0; i < root.childNodes.length; i += 1) {
    const child = root.childNodes.item(i);
    if (child.nodeType === 1) children.push(child as Element);
  }
  return children;
}
