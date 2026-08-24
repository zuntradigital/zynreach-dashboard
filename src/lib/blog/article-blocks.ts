/**
 * The Blog body's structured-content shape (SRS §16 "rich-text fields
 * within a component" carve-out) — kept identical to zynreach-website's
 * ArticleBlock/InlineSpan types (src/types/content.ts) and to this
 * project's own articleBlockSchema (src/lib/validation.ts) so a save
 * round-trips through admin -> DB -> public API -> website with no
 * translation layer anywhere in that chain. This file owns the one
 * conversion this project needs: Tiptap's editor JSON <-> this shape.
 * Tiptap is purely an editing-time UI; this ArticleBlock[] JSON — not
 * Tiptap's document format — is the single source of truth that gets
 * saved.
 */

export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  href?: string;
}

export type ArticleBlock =
  | { type: "paragraph"; text: string; content?: InlineSpan[] }
  | { type: "heading"; id: string; text: string; level?: 1 | 2 | 3; content?: InlineSpan[] }
  | { type: "quote"; text: string; content?: InlineSpan[] }
  | { type: "list"; items: string[]; ordered?: boolean; itemsContent?: InlineSpan[][] }
  | { type: "image"; url: string; alt: string }
  | { type: "code"; code: string; language?: string };

/** Minimal shape of a Tiptap/ProseMirror JSON document — only the node/mark types this editor's toolbar and StarterKit actually produce. */
interface TiptapMark {
  type: "bold" | "italic" | "link";
  attrs?: { href?: string };
}
interface TiptapTextNode {
  type: "text";
  text: string;
  marks?: TiptapMark[];
}
interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: (TiptapNode | TiptapTextNode)[];
}
export interface TiptapDoc {
  type: "doc";
  content: TiptapNode[];
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9؀-ۿ]+/g, "-")
      .replace(/(^-|-$)/g, "") || "section"
  );
}

function isTextNode(node: TiptapNode | TiptapTextNode): node is TiptapTextNode {
  return node.type === "text";
}

/** Flattens a node's inline content into spans + a derived plain-text string, skipping non-text nodes (e.g. hardBreak) as a space. */
function inlineContent(content: (TiptapNode | TiptapTextNode)[] | undefined): { text: string; spans: InlineSpan[] } {
  const spans: InlineSpan[] = [];
  for (const node of content ?? []) {
    if (isTextNode(node)) {
      if (!node.text) continue;
      const marks = node.marks ?? [];
      spans.push({
        text: node.text,
        bold: marks.some((m) => m.type === "bold") || undefined,
        italic: marks.some((m) => m.type === "italic") || undefined,
        href: marks.find((m) => m.type === "link")?.attrs?.href,
      });
    } else {
      spans.push({ text: " " });
    }
  }
  const text = spans
    .map((s) => s.text)
    .join("")
    .trim();
  return { text, spans };
}

function listItemsFrom(node: TiptapNode): { items: string[]; itemsContent: InlineSpan[][] } {
  const items: string[] = [];
  const itemsContent: InlineSpan[][] = [];
  for (const item of node.content ?? []) {
    if (!("content" in item)) continue;
    // A listItem's own content is one or more paragraphs; flatten them into one line.
    const paragraphs = (item as TiptapNode).content ?? [];
    const merged = paragraphs
      .filter((p): p is TiptapNode => !isTextNode(p))
      .flatMap((p) => p.content ?? []);
    const { text, spans } = inlineContent(merged);
    if (text.length === 0) continue;
    items.push(text);
    itemsContent.push(spans);
  }
  return { items, itemsContent };
}

/** Converts a saved Tiptap document (from the Blog body editor) into the canonical ArticleBlock[] shape that gets persisted. Empty paragraphs are dropped rather than rejected, since Tiptap always keeps a trailing empty paragraph for cursor placement. */
export function tiptapDocToArticleBlocks(doc: TiptapDoc): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  for (const node of doc.content) {
    if (node.type === "heading") {
      const { text, spans } = inlineContent(node.content);
      if (!text) continue;
      const rawLevel = (node.attrs?.level as number | undefined) ?? 2;
      const level = (rawLevel < 1 ? 1 : rawLevel > 3 ? 3 : rawLevel) as 1 | 2 | 3;
      blocks.push({ type: "heading", id: slugify(text), text, level, content: spans });
    } else if (node.type === "blockquote") {
      const inner = (node.content ?? []).flatMap((p) => (isTextNode(p) ? [] : (p.content ?? [])));
      const { text, spans } = inlineContent(inner);
      if (!text) continue;
      blocks.push({ type: "quote", text, content: spans });
    } else if (node.type === "bulletList" || node.type === "orderedList") {
      const { items, itemsContent } = listItemsFrom(node);
      if (items.length === 0) continue;
      blocks.push({ type: "list", items, ordered: node.type === "orderedList", itemsContent });
    } else if (node.type === "image") {
      const src = node.attrs?.src as string | undefined;
      if (!src) continue;
      blocks.push({ type: "image", url: src, alt: (node.attrs?.alt as string | undefined) ?? "" });
    } else if (node.type === "codeBlock") {
      const code = (node.content ?? []).filter(isTextNode).map((t) => t.text).join("\n");
      if (!code) continue;
      blocks.push({ type: "code", code, language: node.attrs?.language as string | undefined });
    } else {
      // paragraph (and any unrecognized block falls back to paragraph handling)
      const { text, spans } = inlineContent(node.content);
      if (!text) continue;
      blocks.push({ type: "paragraph", text, content: spans });
    }
  }
  return blocks;
}

function spansToTiptapText(spans: InlineSpan[] | undefined, fallbackText: string): TiptapTextNode[] {
  const source = spans && spans.length > 0 ? spans : [{ text: fallbackText }];
  const nodes = source
    .filter((s) => s.text.length > 0)
    .map((s): TiptapTextNode => {
      const marks: TiptapMark[] = [];
      if (s.bold) marks.push({ type: "bold" });
      if (s.italic) marks.push({ type: "italic" });
      if (s.href) marks.push({ type: "link", attrs: { href: s.href } });
      return { type: "text", text: s.text, ...(marks.length > 0 ? { marks } : {}) };
    });
  return nodes;
}

/** Converts a saved ArticleBlock[] into a Tiptap document for loading into the editor — the inverse of tiptapDocToArticleBlocks, used when opening an existing (or legacy, pre-rich-text) post for editing. */
export function articleBlocksToTiptapDoc(blocks: ArticleBlock[]): TiptapDoc {
  const content: TiptapNode[] = blocks.map((block): TiptapNode => {
    if (block.type === "heading") {
      return { type: "heading", attrs: { level: block.level ?? 2 }, content: spansToTiptapText(block.content, block.text) };
    }
    if (block.type === "quote") {
      return { type: "blockquote", content: [{ type: "paragraph", content: spansToTiptapText(block.content, block.text) }] };
    }
    if (block.type === "list") {
      return {
        type: block.ordered ? "orderedList" : "bulletList",
        content: block.items.map((item, i) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: spansToTiptapText(block.itemsContent?.[i], item) }],
        })),
      };
    }
    if (block.type === "image") {
      return { type: "image", attrs: { src: block.url, alt: block.alt } };
    }
    if (block.type === "code") {
      return { type: "codeBlock", attrs: { language: block.language ?? null }, content: block.code ? [{ type: "text", text: block.code }] : [] };
    }
    return { type: "paragraph", content: spansToTiptapText(block.content, block.text) };
  });

  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph", content: [] }] };
}

/** True if the block array has at least one block with real content — used for the AR/EN "content exists" publish check. */
export function hasMeaningfulContent(blocks: ArticleBlock[]): boolean {
  return blocks.some((b) => {
    if (b.type === "image") return true;
    if (b.type === "list") return b.items.some((i) => i.trim().length > 0);
    if (b.type === "code") return b.code.trim().length > 0;
    return b.text.trim().length > 0;
  });
}
