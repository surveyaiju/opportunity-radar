const fs = require("fs");

const data = JSON.parse(
  fs.readFileSync(
    "./opportunities-clean.json",
    "utf8"
  )
);

function extractDeadline(text) {

  const patterns = [

    /\b\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s\d{4}\b/i,

    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s\d{1,2},?\s\d{4}\b/i,

    /\b\d{4}-\d{2}-\d{2}\b/
  ];

  for (const pattern of patterns) {

    const match = text.match(pattern);

    if (match) return match[0];
  }

  return "";
}

function extractPrize(text) {

  const matches = text.match(
    /\$[\d,]+|€[\d,]+|£[\d,]+/g
  );

  if (!matches) return "";

  return matches[0];
}

function extractFee(text) {

  const t = text.toLowerCase();

  if (
    t.includes("free entry") ||
    t.includes("no fee") ||
    t.includes("free of charge")
  ) {
    return "Free";
  }

  if (
    t.includes("entry fee") ||
    t.includes("registration fee")
  ) {
    return "Has Fee";
  }

  return "";
}

function extractCountry(text) {

  const countries = [

    "United States",
    "USA",
    "Canada",
    "Mexico",

    "United Kingdom",
    "UK",

    "France",
    "Germany",
    "Italy",
    "Spain",
    "Portugal",
    "Netherlands",
    "Belgium",
    "Austria",
    "Switzerland",

    "Australia",
    "New Zealand",

    "Japan",
    "China",
    "Taiwan",
    "South Korea",
    "Singapore",

    "India",
    "Brazil",
    "Chile",
    "Argentina"
  ];

  for (const country of countries) {

    if (
      text.toLowerCase()
      .includes(country.toLowerCase())
    ) {
      return country;
    }

  }

  return "";
}

function extractEligibility(text) {

  const t = text.toLowerCase();

  if (
    t.includes("students only")
  ) {
    return "Students";
  }

  if (
    t.includes("emerging architects")
  ) {
    return "Emerging Professionals";
  }

  if (
    t.includes("open to all")
  ) {
    return "Open";
  }

  if (
    t.includes("licensed architect")
  ) {
    return "Licensed Architects";
  }

  return "";
}

function extractOrganization(item) {

  if (item.source) {
    return item.source;
  }

  return "";
}

const enriched = data.map(item => {

  const text = [
    item.title || "",
    item.description || ""
  ].join(" ");

  return {

    ...item,

    deadline:
      item.deadline ||
      extractDeadline(text),

    fee:
      item.fee ||
      extractFee(text),

    prize:
      extractPrize(text),

    country:
      extractCountry(text),

    eligibility:
      extractEligibility(text),

    organization:
      extractOrganization(item)
  };

});

fs.writeFileSync(
  "./opportunities.json",
  JSON.stringify(
    enriched,
    null,
    2
  )
);

console.log(
  `Enriched ${enriched.length} opportunities`
);
