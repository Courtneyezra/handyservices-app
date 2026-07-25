import { useEffect } from "react";

/**
 * Client-side SEO head management for SPA pages that need per-page title/meta —
 * e.g. the city landings (/nottingham, /derby) which serve the React app rather
 * than the server-rendered SEO hub. Sets <title>, meta description, canonical
 * and OpenGraph tags, and restores the previous title on unmount.
 *
 * Note: this runs after JS hydration. Google renders JS so it will pick these
 * up, but for a small number of high-value pages that's sufficient; the bulk
 * long-tail SEO stays server-rendered under server/seo/.
 */
export interface PageSeo {
  title: string;
  description: string;
  /** Absolute canonical URL, e.g. https://www.handyservices.app/nottingham */
  canonical: string;
}

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

export function usePageSeo({ title, description, canonical }: PageSeo) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;
    upsertMeta("name", "description", description);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:url", canonical);

    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    const prevHref = link.href;
    link.href = canonical;

    return () => {
      document.title = prevTitle;
      if (link) link.href = prevHref;
    };
  }, [title, description, canonical]);
}
