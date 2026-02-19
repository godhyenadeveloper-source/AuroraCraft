import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "prose-headings:mb-2 prose-headings:mt-4 first:prose-headings:mt-0",
        "prose-p:my-1.5 prose-p:leading-relaxed",
        "prose-ul:my-1.5 prose-ol:my-1.5",
        "prose-li:my-0.5",
        "prose-pre:my-2 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border prose-pre:rounded-lg",
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-hr:my-3",
        "prose-blockquote:my-2 prose-blockquote:border-primary/50",
        "prose-table:my-2",
        "prose-img:my-2",
        "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
        className,
      )}
      components={{
        code({ className: codeClassName, children, ...props }) {
          const match = /language-(\w+)/.exec(codeClassName || "");
          const isBlock = match || (typeof children === "string" && children.includes("\n"));

          if (isBlock) {
            return (
              <code
                className={cn(
                  "block text-xs font-mono leading-relaxed",
                  codeClassName,
                )}
                {...props}
              >
                {children}
              </code>
            );
          }

          return (
            <code
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
              {...props}
            >
              {children}
            </code>
          );
        },
        a({ href, children, ...props }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
              {children}
            </a>
          );
        },
        pre({ children, ...props }) {
          return (
            <pre
              className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 text-xs"
              {...props}
            >
              {children}
            </pre>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
