export function extractSources(message) {
  const sources = [],
    seen = new Set();
  for (const annotation of message.annotations ?? []) {
    if (annotation.type !== "url_citation") continue;
    const c = annotation.url_citation;
    if (!c?.url) continue;
    try {
      const url = new URL(c.url);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        seen.has(url.href)
      )
        continue;
      seen.add(url.href);
      sources.push({
        id: crypto.randomUUID(),
        title: typeof c.title === "string" ? c.title : url.hostname,
        url: url.href,
      });
    } catch {
      /* Ignore invalid annotations. */
    }
  }
  return sources;
}
