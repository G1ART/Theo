import type { ReactNode } from "react";

/**
 * Tiny markdown subset for Theo Board bodies. Renders React nodes
 * (HTML in the source is shown as text — no unsanitized innerHTML).
 *
 * Supported: paragraphs, **bold**, *italic*, [text](http(s) url),
 * `#` / `##` headings, `- ` lists.
 */

type Props = {
  source: string;
  className?: string;
};

function isHttpUrl(href: string): boolean {
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re =
    /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] != null) {
      nodes.push(<strong key={`${keyPrefix}-b-${i}`}>{m[1]}</strong>);
    } else if (m[2] != null) {
      nodes.push(<em key={`${keyPrefix}-i-${i}`}>{m[2]}</em>);
    } else if (m[3] != null && m[4] != null && isHttpUrl(m[4])) {
      nodes.push(
        <a
          key={`${keyPrefix}-a-${i}`}
          href={m[4]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
        >
          {m[3]}
        </a>,
      );
    } else {
      nodes.push(m[0]);
    }
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function isListItem(line: string): boolean {
  return line.startsWith("- ");
}

function headingLevel(line: string): 1 | 2 | 0 {
  if (line.startsWith("## ")) return 2;
  if (line.startsWith("# ")) return 1;
  return 0;
}

export function SafeMd({ source, className }: Props) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const h = headingLevel(line);
    if (h === 1 || h === 2) {
      const text = line.slice(h === 1 ? 2 : 3);
      const Tag = h === 1 ? "h1" : "h2";
      const cls =
        h === 1
          ? "text-xl font-semibold tracking-tight text-zinc-900"
          : "text-lg font-semibold tracking-tight text-zinc-900";
      blocks.push(
        <Tag key={`h-${b}`} className={cls}>
          {renderInline(text, `h${b}`)}
        </Tag>,
      );
      b += 1;
      i += 1;
      continue;
    }

    if (isListItem(line)) {
      const items: string[] = [];
      while (i < lines.length && isListItem(lines[i])) {
        items.push(lines[i].slice(2));
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${b}`} className="list-disc space-y-1 pl-5">
          {items.map((item, idx) => (
            <li key={`li-${b}-${idx}`}>{renderInline(item, `li${b}-${idx}`)}</li>
          ))}
        </ul>,
      );
      b += 1;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isListItem(lines[i]) &&
      headingLevel(lines[i]) === 0
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`p-${b}`} className="leading-relaxed">
        {renderInline(para.join(" "), `p${b}`)}
      </p>,
    );
    b += 1;
  }

  if (blocks.length === 0) return null;

  return (
    <div className={`space-y-3 text-sm text-zinc-700 ${className ?? ""}`}>
      {blocks}
    </div>
  );
}
