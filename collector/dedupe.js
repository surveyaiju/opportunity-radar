const fs = require("fs");

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a, b) {
  const aa = normalizeTitle(a);
  const bb = normalizeTitle(b);

  if (aa === bb) return 1;

  const wordsA = new Set(aa.split(" "));
  const wordsB = new Set(bb.split(" "));

  const intersection = [...wordsA].filter(x =>
    wordsB.has(x)
  ).length;

  const union = new Set([
    ...wordsA,
    ...wordsB
  ]).size;

  return intersection / union;
}

function mergeOpportunity(existing, incoming) {

  const merged = { ...existing };

  if (
    (!merged.deadline || merged.deadline === "") &&
    incoming.deadline
  ) {
    merged.deadline = incoming.deadline;
  }

  if (
    (!merged.fee || merged.fee === "") &&
    incoming.fee
  ) {
    merged.fee = incoming.fee;
  }

  if (
    incoming.description &&
    incoming.description.length >
      (merged.description || "").length
  ) {
    merged.description = incoming.description;
  }

  merged.sources = merged.sources || [
    existing.source
  ];

  if (
    incoming.source &&
    !merged.sources.includes(incoming.source)
  ) {
    merged.sources.push(incoming.source);
  }

  return merged;
}

function dedupe(items) {

  const unique = [];

  for (const item of items) {

    let matched = false;

    for (let i = 0; i < unique.length; i++) {

      const score = similarity(
        item.title,
        unique[i].title
      );

      if (score > 0.75) {

        unique[i] = mergeOpportunity(
          unique[i],
          item
        );

        matched = true;

        break;
      }
    }

    if (!matched) {

      unique.push({
        ...item,
        sources: [item.source]
      });
    }
  }

  return unique;
}

const rssData = JSON.parse(
  fs.readFileSync(
    "./opportunities-rss.json",
    "utf8"
  )
);

const cleaned = dedupe(rssData);

fs.writeFileSync(
  "./opportunities-clean.json",
  JSON.stringify(cleaned, null, 2)
);

console.log(
  `Deduped ${rssData.length} → ${cleaned.length}`
);
