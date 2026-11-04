import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("js", javascript);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("css", css);
function Code({ className, children }) {
  const [copied, setCopied] = useState(false);
  const value = String(children).replace(/\n$/, "");
  const lang = /language-(\w+)/.exec(className ?? "")?.[1];
  if (!lang && !String(children).includes("\n"))
    return <code className="inline-code">{children}</code>;
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang ?? "text"}</span>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "복사됨" : "코드 복사"}
        </button>
      </div>
      <SyntaxHighlighter
        language={lang ?? "text"}
        style={oneDark}
        customStyle={{ margin: 0, borderRadius: 0 }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}
export default function MarkdownMessage({ content }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          code: Code,
          pre: ({ children }) => <div>{children}</div>,
          a: ({ href, children }) =>
            /^https?:\/\//i.test(href ?? "") ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
