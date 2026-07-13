const path = require("node:path");
const { readJson, writeJson } = require("./lib/file-utils");
const { classifyLocally, validateModelClassification, CANONICAL_CATEGORIES } = require("./lib/classification");
const { isLlmConfigured, requestDeepSeekJson } = require("./lib/deepseek-summary-client");

const ROOT_DIR = path.resolve(__dirname, "..");

function reviewPrompt(entries) {
  return [
    "Classify each news item by its core event. Return valid JSON only.",
    `Allowed category: ${CANONICAL_CATEGORIES.join(", ")}.`,
    "Use sourceCategory only as low-weight context. Secondary tags must be concrete topics, entities, technologies or policies, not another primary category.",
    "Return {items:[{id,category,secondaryTags,confidence,reason,candidateConflicts}]}. Preserve every input id.",
    JSON.stringify({ items: entries.map(({ item, local }) => ({ id: item.id, title: item.title, summary: item.summary, body: item.bodyText || item.contentExcerpt, sourceCategory: item.sourceCategory, eventType: item.eventType, local })) })
  ].join("\n");
}

async function classifyItems(items, rules = {}, options = {}) {
  const configured = isLlmConfigured(rules, options.env || process.env);
  const locals = items.map((item) => ({ item, local: classifyLocally(item) }));
  const reviewed = new Map();
  const errors = new Map();
  const reviewEntries = locals.filter(({ local }) => local.requiresReview);
  const batchSize = Math.max(1, Number(options.batchSize || 8));
  if (configured) {
    for (let index = 0; index < reviewEntries.length; index += batchSize) {
      const batch = reviewEntries.slice(index, index + batchSize);
      try {
        const response = await requestDeepSeekJson(reviewPrompt(batch), rules, options);
        const responseById = new Map((response.items || []).map((entry) => [entry.id, entry]));
        batch.forEach(({ item, local }) => {
          const validated = validateModelClassification(responseById.get(item.id), local);
          if (validated) reviewed.set(item.id, validated);
          else errors.set(item.id, "Model classification response was missing or invalid.");
        });
      } catch (error) {
        batch.forEach(({ item }) => errors.set(item.id, error.message));
      }
    }
  }
  return locals.map(({ item, local }) => {
    const result = reviewed.get(item.id) || local;
    const auditRequired = local.requiresReview && !reviewed.has(item.id);
    return {
      ...item,
      category: result.category,
      sourceCategory: result.sourceCategory,
      secondaryTags: result.secondaryTags,
      classification: auditRequired
        ? { ...result.classification, status: "audit-required", ...(errors.has(item.id) ? { reviewError: errors.get(item.id) } : {}) }
        : result.classification
    };
  });
}

async function runClassification(options = {}) {
  const items = readJson(path.join(ROOT_DIR, "data", "processed", "content-reviewed-items.json"), { items: [] }).items || [];
  const rules = readJson(path.join(ROOT_DIR, "config", "ai-summary-rules.json"), {});
  const classified = await classifyItems(items, rules, options);
  writeJson(path.join(ROOT_DIR, "data", "processed", "classified-items.json"), classified);
  return classified;
}

if (require.main === module) {
  runClassification().then((items) => console.log(`Classified ${items.length} reviewed items.`)).catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { classifyItems, runClassification, reviewPrompt };
