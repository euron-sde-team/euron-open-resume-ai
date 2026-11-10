import { Fragment, type ReactNode } from "react";

/**
 * Model answers are lightly formatted text: paragraphs, bullet lists, fenced code and
 * `inline code`. This renders exactly that and nothing else, as React elements, so
 * nothing from the model ever becomes markup (no raw HTML, no links, no images).
 */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.92em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

type Block = { kind: "p"; text: string } | { kind: "ul"; items: string[] } | { kind: "code"; text: string };

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trimStart().startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trimStart().startsWith("```")) code.push(lines[i++]!);
      i += 1;
      blocks.push({ kind: "code", text: code.join("\n") });
    } else if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      blocks.push({ kind: "ul", items });
    } else if (!line.trim()) {
      i += 1;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() && !lines[i]!.trimStart().startsWith("```") && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) para.push(lines[i++]!);
      blocks.push({ kind: "p", text: para.join(" ") });
    }
  }
  return blocks;
}

export function SimpleText({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className}>
      {parseBlocks(children).map((b, i) =>
        b.kind === "code" ? (
          <pre key={i} className="my-2 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[13px] leading-relaxed">
            <code>{b.text}</code>
          </pre>
        ) : b.kind === "ul" ? (
          <ul key={i} className="my-2 list-disc space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="my-2">
            {inline(b.text)}
          </p>
        ),
      )}
    </div>
  );
}
