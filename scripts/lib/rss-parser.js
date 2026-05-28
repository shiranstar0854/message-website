function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

function extractTag(block, tagName) {
  const direct = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(block);
  if (direct) return decodeXml(direct[1]);

  const selfClosing = new RegExp(`<${tagName}(?:\\s[^>]*)?href=["']([^"']+)["'][^>]*\\/?>`, "i").exec(block);
  return selfClosing ? decodeXml(selfClosing[1]) : "";
}

function extractAttributes(tag) {
  return [...String(tag || "").matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].reduce((attrs, match) => {
    attrs[match[1].toLowerCase()] = decodeXml(match[2]);
    return attrs;
  }, {});
}

function findTagAttributes(block, tagName) {
  const tag = new RegExp(`<${tagName}(?:\\s[^>]*)?\\/?>`, "i").exec(block);
  return tag ? extractAttributes(tag[0]) : {};
}

function extractFirstImageFromHtml(value) {
  const match = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i.exec(String(value || ""));
  return match ? decodeXml(match[1]) : "";
}

function extractFeedImage(block, description, content) {
  const mediaContent = findTagAttributes(block, "media:content");
  if (mediaContent.url && (!mediaContent.medium || mediaContent.medium === "image")) return mediaContent.url;

  const mediaThumbnail = findTagAttributes(block, "media:thumbnail");
  if (mediaThumbnail.url) return mediaThumbnail.url;

  const enclosure = findTagAttributes(block, "enclosure");
  if (enclosure.url && String(enclosure.type || "").toLowerCase().startsWith("image/")) return enclosure.url;

  return extractFirstImageFromHtml(content) || extractFirstImageFromHtml(description);
}

function extractItems(xml) {
  const blocks = [...String(xml || "").matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
  return blocks.map((match) => {
    const block = match[2];
    const description = extractTag(block, "description") || extractTag(block, "summary");
    const content = extractTag(block, "content:encoded") || extractTag(block, "content");
    return {
      title: extractTag(block, "title"),
      link: extractTag(block, "link"),
      guid: extractTag(block, "guid") || extractTag(block, "id"),
      pubDate: extractTag(block, "pubDate") || extractTag(block, "published") || extractTag(block, "updated"),
      description,
      content,
      feedImageUrl: extractFeedImage(block, description, content),
      categories: [...block.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)].map((entry) => decodeXml(entry[1]))
    };
  });
}

module.exports = {
  decodeXml,
  extractFirstImageFromHtml,
  extractItems
};
