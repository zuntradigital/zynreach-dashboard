"use client";

import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TiptapImage from "@tiptap/extension-image";
import { useTranslations } from "next-intl";
import { articleBlocksToTiptapDoc, tiptapDocToArticleBlocks, type ArticleBlock, type TiptapDoc } from "@/lib/blog/article-blocks";

interface BlogBodyEditorProps {
  value: ArticleBlock[];
  onChange: (blocks: ArticleBlock[]) => void;
  disabled?: boolean;
  dir: "ltr" | "rtl";
  /** Opens the shared MediaPicker and resolves the chosen asset, or null if cancelled — the toolbar's Image button inserts through the same media pipeline every other picker in the Dashboard uses, rather than a raw URL prompt. */
  onRequestImage: () => Promise<{ url: string; alt: string } | null>;
}

/**
 * The Blog body's rich-text toolbar (H1-H3, Bold, Italic, ordered/bullet
 * list, Link, Image) — a real editor, not the previous plain textarea with
 * markdown-shorthand parsing. Tiptap is purely the editing surface; its
 * document is converted to/from the canonical ArticleBlock[] shape
 * (src/lib/blog/article-blocks.ts) on every change, so the saved data
 * stays identical to what the public API and website already read —
 * no second content format.
 */
export function BlogBodyEditor({ value, onChange, disabled, dir, onRequestImage }: BlogBodyEditorProps) {
  const t = useTranslations("dashboard.blog");
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    content: articleBlocksToTiptapDoc(value) as unknown as Record<string, unknown>,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: false, autolink: false }),
      TiptapImage.configure({ inline: false }),
    ],
    onUpdate: ({ editor: e }) => {
      onChange(tiptapDocToArticleBlocks(e.getJSON() as unknown as TiptapDoc));
    },
  });

  if (!editor) return null;

  function toggleHeading(level: 1 | 2 | 3) {
    editor!.chain().focus().toggleHeading({ level }).run();
  }

  async function handleImageClick() {
    // Capture the insertion point before opening the (async) media picker:
    // once it opens, DOM focus moves off the editor, and by the time the
    // picker resolves the browser's selection can no longer be trusted to
    // reflect where the cursor was when the user clicked Insert image.
    const { $from } = editor!.state.selection;
    let insertPos = editor!.state.selection.to;
    // If that position is inside a list item, insert after the whole list
    // instead: the canonical ArticleBlock "list" type only stores item
    // text, so an image nested inside a list item has nowhere to
    // round-trip to and would silently vanish on save.
    let listDepth = $from.depth;
    while (listDepth > 0 && !["bulletList", "orderedList"].includes($from.node(listDepth).type.name)) listDepth--;
    if (listDepth > 0) insertPos = $from.after(listDepth);

    const asset = await onRequestImage();
    if (!asset) return;
    editor!.chain().focus().insertContentAt(insertPos, { type: "image", attrs: { src: asset.url, alt: asset.alt } }).run();
  }

  function handleLinkClick() {
    // Clicking Link on an existing link opens the same popup pre-filled
    // with its current URL so it can be edited in place, instead of
    // silently unlinking on click — removal is now its own explicit
    // action (removeLink) inside the popup.
    if (editor!.isActive("link")) {
      setLinkUrl((editor!.getAttributes("link").href as string | undefined) ?? "");
      setLinkInputOpen(true);
      return;
    }
    const { from, to } = editor!.state.selection;
    if (from === to) return; // require a text selection before offering to link it
    setLinkUrl("");
    setLinkInputOpen(true);
  }

  function applyLink() {
    if (linkUrl.trim()) {
      editor!.chain().focus().extendMarkRange("link").setLink({ href: linkUrl.trim() }).run();
    }
    setLinkInputOpen(false);
  }

  function removeLink() {
    editor!.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkInputOpen(false);
  }

  const btn = (active: boolean) =>
    `min-h-8 min-w-8 rounded-md px-2 text-sm font-medium ${active ? "bg-primary-100 text-primary-700" : "text-neutral-600 hover:bg-neutral-100"} disabled:opacity-40`;

  return (
    <div className={disabled ? "rounded-md border border-neutral-200 bg-neutral-50" : ""}>
      <div className="flex flex-wrap items-center gap-1 border-b border-neutral-200 pb-2.5">
        <button type="button" disabled={disabled} onClick={() => toggleHeading(1)} className={btn(editor.isActive("heading", { level: 1 }))} aria-label={t("toolbarH1")}>
          H1
        </button>
        <button type="button" disabled={disabled} onClick={() => toggleHeading(2)} className={btn(editor.isActive("heading", { level: 2 }))} aria-label={t("toolbarH2")}>
          H2
        </button>
        <button type="button" disabled={disabled} onClick={() => toggleHeading(3)} className={btn(editor.isActive("heading", { level: 3 }))} aria-label={t("toolbarH3")}>
          H3
        </button>
        <span className="mx-1 h-5 w-px bg-neutral-200" aria-hidden="true" />
        <button
          type="button"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`${btn(editor.isActive("bold"))} font-bold`}
          aria-label={t("toolbarBold")}
        >
          B
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`${btn(editor.isActive("italic"))} italic`}
          aria-label={t("toolbarItalic")}
        >
          I
        </button>
        <span className="mx-1 h-5 w-px bg-neutral-200" aria-hidden="true" />
        <button
          type="button"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={btn(editor.isActive("orderedList"))}
          aria-label={t("toolbarOrderedList")}
        >
          1.
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={btn(editor.isActive("bulletList"))}
          aria-label={t("toolbarBulletList")}
        >
          •
        </button>
        <span className="mx-1 h-5 w-px bg-neutral-200" aria-hidden="true" />
        <button type="button" disabled={disabled} onClick={handleLinkClick} className={`${btn(editor.isActive("link"))} min-w-fit px-2.5 underline`} aria-label={t("toolbarLink")}>
          {t("toolbarLinkShort")}
        </button>
        <button type="button" disabled={disabled} onClick={() => void handleImageClick()} className={`${btn(false)} min-w-fit px-2.5`} aria-label={t("toolbarImage")}>
          {t("toolbarImageShort")}
        </button>
      </div>

      {linkInputOpen ? (
        <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 p-2">
          <input
            type="text"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
            placeholder={t("linkUrlPlaceholder")}
            autoFocus
            className="min-h-8 flex-1 rounded-md border border-neutral-300 bg-surface px-2 text-sm text-neutral-900"
          />
          <button type="button" onClick={applyLink} className="min-h-8 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700">
            {t("linkApply")}
          </button>
          {editor.isActive("link") ? (
            <button type="button" onClick={removeLink} className="min-h-8 rounded-md px-3 text-sm font-medium text-error hover:bg-error-bg">
              {t("linkRemove")}
            </button>
          ) : null}
          <button type="button" onClick={() => setLinkInputOpen(false)} className="min-h-8 rounded-md px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100">
            {t("cancel")}
          </button>
        </div>
      ) : null}

      <div
        dir={dir}
        onClick={(e) => {
          // Clicking below the last line (in the surrounding padding) should
          // still focus the editor and place the cursor, like clicking in
          // any real writing surface — not just when hitting existing text.
          if (e.target === e.currentTarget) editor!.chain().focus("end").run();
        }}
        className="prose-editor max-h-[32rem] min-h-[20rem] cursor-text overflow-y-auto px-1 py-4"
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
