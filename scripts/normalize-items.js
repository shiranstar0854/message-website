const path = require("node:path");
const { normalizeRawItem } = require("./lib/pipeline");
const { getRecordItems } = require("./fetch-rss");
const { readJson, writeJson } = require("./lib/file-utils");

const ROOT_DIR = path.resolve(__dirname, "..");

function flattenApiBody(record) {
  if (Array.isArray(record.body)) return record.body;
  if (Array.isArray(record.body?.items)) return record.body.items;
  if (Array.isArray(record.body?.articles)) return record.body.articles;
  if (Array.isArray(record.body?.data)) return record.body.data;
  if (record.body && typeof record.body === "object") return [record.body];
  return [];
}

function normalizeAll() {
  const rssRecords = readJson(path.join(ROOT_DIR, "data", "raw", "rss-items.json"), []);
  const apiRecords = readJson(path.join(ROOT_DIR, "data", "raw", "api-items.json"), []);
  const webRecords = readJson(path.join(ROOT_DIR, "data", "raw", "webpage-items.json"), []);
  const normalized = [];

  rssRecords.forEach((record) => {
    const items = getRecordItems(record);
    items.forEach((item) => {
      normalized.push(normalizeRawItem({
        ...record,
        item
      }, record.fetchedAt || new Date().toISOString()));
    });
  });

  apiRecords.forEach((record) => {
    flattenApiBody(record).forEach((item) => {
      normalized.push(normalizeRawItem({
        ...record,
        item
      }, record.fetchedAt || new Date().toISOString()));
    });
  });

  webRecords.forEach((record) => {
    (record.items || []).forEach((item) => {
      normalized.push(normalizeRawItem({
        ...record,
        sourceLastCheckedAt: record.fetchedAt,
        item
      }, record.fetchedAt || new Date().toISOString()));
    });
  });

  return normalized;
}

if (require.main === module) {
  const normalized = normalizeAll();
  writeJson(path.join(ROOT_DIR, "data", "normalized", "normalized-items.json"), normalized);
  console.log(`Normalized ${normalized.length} items.`);
}

module.exports = {
  normalizeAll
};
