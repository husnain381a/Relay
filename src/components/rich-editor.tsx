"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";

export interface RichEditorHandle {
  insertText(text: string): void;
  insertLink(label: string, href: string): void;
  bold(): void;
  italic(): void;
  code(): void;
  list(): void;
}
/** A schema-based editor; persistence remains Markdown, never arbitrary HTML. */
export const RichEditor = forwardRef<
  RichEditorHandle,
  {
    value: string;
    label: string;
    placeholder: string;
    disabled?: boolean;
    onChange: (markdown: string) => void;
    onSend: () => void;
    onError: (message: string) => void;
  }
>(({ value, label, placeholder, disabled, onChange, onSend, onError }, ref) => {
  const callbacks = useRef({ onChange, onSend, onError });
  callbacks.current = { onChange, onSend, onError };
  const lastValid = useRef(value);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        underline: false,
        link: {
          openOnClick: false,
          defaultProtocol: "https",
          protocols: ["https", "http"],
        },
      }),
      Markdown,
    ],
    content: value,
    contentType: "markdown",
    editable: !disabled,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "true",
        class: "rich-text-editor markdown",
        "data-placeholder": placeholder,
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          callbacks.current.onSend();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      const markdown = current.getMarkdown();
      if (markdown.length > 12000) {
        current.commands.setContent(lastValid.current, {
          contentType: "markdown",
          emitUpdate: false,
        });
        callbacks.current.onError(
          "Messages can contain up to 12,000 characters, including formatting.",
        );
        return;
      }
      lastValid.current = markdown;
      callbacks.current.onChange(markdown);
    },
  });
  useEffect(() => {
    if (!editor || editor.getMarkdown() === value) return;
    lastValid.current = value;
    editor.commands.setContent(value, {
      contentType: "markdown",
      emitUpdate: false,
    });
  }, [editor, value]);
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);
  useEffect(() => {
    editor?.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          role: "textbox",
          "aria-label": label,
          "aria-multiline": "true",
          class: "rich-text-editor markdown",
          "data-placeholder": placeholder,
        },
      },
    });
  }, [editor, label, placeholder]);
  useImperativeHandle(
    ref,
    () => ({
      insertText: (text) => {
        if (!disabled)
          editor?.chain().focus().insertContent({ type: "text", text }).run();
      },
      insertLink: (text, href) => {
        if (!disabled)
          editor
            ?.chain()
            .focus()
            .insertContent([
              {
                type: "text",
                text,
                marks: [{ type: "link", attrs: { href } }],
              },
              { type: "text", text: " " },
            ])
            .run();
      },
      bold: () => {
        if (!disabled) editor?.chain().focus().toggleBold().run();
      },
      italic: () => {
        if (!disabled) editor?.chain().focus().toggleItalic().run();
      },
      code: () => {
        if (!disabled) editor?.chain().focus().toggleCode().run();
      },
      list: () => {
        if (!disabled) editor?.chain().focus().toggleBulletList().run();
      },
    }),
    [editor, disabled],
  );
  return <EditorContent editor={editor} className="rich-editor-shell" />;
});
RichEditor.displayName = "RichEditor";
