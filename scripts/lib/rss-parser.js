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

function extractItems(xml) {
  const blocks = [...String(xml || "").matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
  return blocks.map((match) => {
    const block = match[2];
    return {
      title: extractTag(block, "title"),
      link: extractTag(block, "link"),
      guid: extractTag(block, "guid") || extractTag(block, "id"),
      pubDate: extractTag(block, "pubDate") || extractTag(block, "published") || extractTag(block, "updated"),
      description: extractTag(block, "description") || extractTag(block, "summary"),
      content: extractTag(block, "content:encoded") || extractTag(block, "content"),
      categories: [...block.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)].map((entry) => decodeXml(entry[1]))
    };
  });
}

module.exports = {
  extractItems
};
