/**
 * OpsMarkdown — renders Ops Manager chat markdown inside an assistant bubble.
 *
 * GFM (tables, task lists, strikethrough) + remark-breaks so single newlines
 * behave like a chat client, styled to the chat dock's compact scale.
 *
 * Links: internal hrefs (starting with "/") navigate in-app via wouter —
 * the whole point of the dock is acting on the app without leaving the page —
 * while external links open in a new tab. The agent deep-links things like
 * /admin/comms?conversation=… and /admin/desk.
 */
import type { AnchorHTMLAttributes } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { useLocation } from 'wouter';
import { cn } from '@/lib/utils';

function MarkdownLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
    const [, navigate] = useLocation();
    const { href = '', children, ...rest } = props;
    const isInternal = href.startsWith('/');
    return (
        <a
            {...rest}
            href={href}
            className="font-medium text-blue-600 underline underline-offset-2 transition-colors hover:text-blue-800"
            {...(isInternal
                ? {
                    onClick: (e) => {
                        e.preventDefault();
                        navigate(href);
                    },
                }
                : { target: '_blank', rel: 'noreferrer' })}
        >
            {children}
        </a>
    );
}

export function OpsMarkdown({ content, className }: { content: string; className?: string }) {
    return (
        <div className={cn('min-w-0 text-sm leading-relaxed', className)}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={{
                    a: MarkdownLink,
                    p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                    ul: ({ children }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-4 last:mb-0">{children}</ul>,
                    ol: ({ children }) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>,
                    li: ({ children }) => <li className="leading-snug">{children}</li>,
                    h1: ({ children }) => <h3 className="mb-1 mt-2 text-[13px] font-semibold first:mt-0">{children}</h3>,
                    h2: ({ children }) => <h3 className="mb-1 mt-2 text-[13px] font-semibold first:mt-0">{children}</h3>,
                    h3: ({ children }) => <h3 className="mb-1 mt-2 text-[13px] font-semibold first:mt-0">{children}</h3>,
                    h4: ({ children }) => <h4 className="mb-1 mt-2 text-[13px] font-semibold first:mt-0">{children}</h4>,
                    blockquote: ({ children }) => (
                        <blockquote className="mb-1.5 border-l-2 border-slate-300 pl-2 italic text-slate-500 last:mb-0">{children}</blockquote>
                    ),
                    hr: () => <hr className="my-2 border-slate-200" />,
                    code: ({ children }) => (
                        <code className="rounded bg-black/10 px-1 py-px font-mono text-[12px]">{children}</code>
                    ),
                    pre: ({ children }) => (
                        <pre className="mb-1.5 overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-2 text-xs last:mb-0 [&_code]:bg-transparent [&_code]:p-0">
                            {children}
                        </pre>
                    ),
                    table: ({ children }) => (
                        <div className="mb-1.5 overflow-x-auto last:mb-0">
                            <table className="w-full border-collapse text-xs">{children}</table>
                        </div>
                    ),
                    th: ({ children }) => (
                        <th className="border border-slate-200 bg-slate-50 px-1.5 py-1 text-left font-semibold">{children}</th>
                    ),
                    td: ({ children }) => <td className="border border-slate-200 px-1.5 py-1 align-top">{children}</td>,
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
