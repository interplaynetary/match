/**
 * Transform Examples Script
 *
 * Converts matching-examples.json from the old structured format to the new
 * expressions-based format.
 *
 * Old format:
 *   {
 *     structured: {
 *       capacityType: "flour",
 *       attributes: { organic: true }
 *     }
 *   }
 *
 * New format:
 *   {
 *     expressions: [
 *       { text: "organic flour" },
 *       { text: "flour" }
 *     ]
 *   }
 *
 * Usage:
 *   bun scripts/transform-examples.ts
 *
 * This script reads data/matching-examples.json, transforms each example,
 * and writes the result back to the same file.
 */

import { readFileSync, writeFileSync } from "fs";

interface OldExample {
  id: number;
  category: string;
  naturalLanguage: string;
  type: "capacity" | "need";
  structured: {
    capacityType?: string;
    satisfactionPaths?: Array<{
      requires: string;
      [key: string]: unknown;
    }>;
    subCapacities?: Array<{ type: string }>;
    attributes?: Record<string, unknown>;
    constraints?: Record<string, unknown>;
    [key: string]: unknown;
  };
  shouldMatchWith?: string[];
  notes?: string;
}

interface NewExample {
  id: number;
  category: string;
  naturalLanguage: string;
  type: "capacity" | "need";
  expressions: Array<{ text: string }>;
  constraints?: Record<string, unknown>;
  shouldMatchWith?: string[];
  notes?: string;
}

function extractExpressionsFromCapacity(example: OldExample): string[] {
  const expressions: string[] = [];
  const structured = example.structured;

  // Start with capacity type
  const capacityType = structured.capacityType || "";

  // Build expressions based on attributes
  const attrs = structured.attributes || {};
  const constraints = structured.constraints || {};

  // Main expression from natural language (extract key phrase)
  const mainPhrase = extractMainPhrase(example.naturalLanguage, example.type);
  if (mainPhrase) {
    expressions.push(mainPhrase);
  }

  // Expression from capacity type + key attributes
  if (capacityType) {
    const typeExpression = buildTypeExpression(capacityType, attrs);
    if (typeExpression && !expressions.includes(typeExpression)) {
      expressions.push(typeExpression);
    }

    // Also add the base type if different
    const baseType = formatType(capacityType);
    if (baseType && !expressions.includes(baseType)) {
      expressions.push(baseType);
    }
  }

  // Add sub-capacities as separate expressions
  if (structured.subCapacities) {
    for (const sub of structured.subCapacities) {
      const subType = formatType(sub.type);
      if (subType && !expressions.includes(subType)) {
        expressions.push(subType);
      }
    }
  }

  return expressions.filter((e) => e.length > 0);
}

function extractExpressionsFromNeed(example: OldExample): string[] {
  const expressions: string[] = [];
  const structured = example.structured;
  const paths = structured.satisfactionPaths || [];

  // Main expression from natural language
  const mainPhrase = extractMainPhrase(example.naturalLanguage, example.type);
  if (mainPhrase) {
    expressions.push(mainPhrase);
  }

  // Expressions from satisfaction paths
  for (const path of paths) {
    const requires = path.requires;
    if (!requires || requires === "unknown") continue;

    // Build expression from path
    const pathExpression = buildPathExpression(path);
    if (pathExpression && !expressions.includes(pathExpression)) {
      expressions.push(pathExpression);
    }

    // Also add the base requires type
    const baseType = formatType(requires);
    if (baseType && !expressions.includes(baseType)) {
      expressions.push(baseType);
    }
  }

  return expressions.filter((e) => e.length > 0);
}

function extractMainPhrase(naturalLanguage: string, type: string): string {
  // Extract a key phrase from natural language
  let phrase = naturalLanguage;

  // Remove common prefixes
  const prefixes = [
    "I have ",
    "I'm a ",
    "I'm ",
    "I am a ",
    "I am ",
    "I can ",
    "I do ",
    "I offer ",
    "I make ",
    "I grow ",
    "I bake ",
    "I speak ",
    "Looking for ",
    "Need to ",
    "Need a ",
    "Need an ",
    "Need ",
    "Seeking ",
    "Anyone have ",
    "I need ",
    "Our nonprofit needs ",
    "We need ",
  ];

  for (const prefix of prefixes) {
    if (phrase.toLowerCase().startsWith(prefix.toLowerCase())) {
      phrase = phrase.substring(prefix.length);
      break;
    }
  }

  // Remove trailing phrases
  const suffixes = [
    " this weekend",
    " for baking bread",
    " I can lend out",
    " available",
    " and can help with",
    " who can come to my home",
    " for my",
    " while I travel",
    " while I'm traveling",
  ];

  for (const suffix of suffixes) {
    const idx = phrase.toLowerCase().indexOf(suffix.toLowerCase());
    if (idx > 0) {
      phrase = phrase.substring(0, idx);
    }
  }

  // Truncate if too long (find natural break point)
  if (phrase.length > 60) {
    const breakPoints = [", ", " - ", " and ", " but "];
    for (const bp of breakPoints) {
      const idx = phrase.indexOf(bp);
      if (idx > 10 && idx < 60) {
        phrase = phrase.substring(0, idx);
        break;
      }
    }
  }

  // Clean up
  phrase = phrase.trim();
  if (phrase.endsWith(",") || phrase.endsWith(".")) {
    phrase = phrase.slice(0, -1);
  }

  return phrase;
}

function buildTypeExpression(
  capacityType: string,
  attrs: Record<string, unknown>
): string {
  const parts: string[] = [];

  // Add key attributes as modifiers
  if (attrs.organic === true) parts.push("organic");
  if (attrs.certified === true) parts.push("certified");
  if (attrs.level === "professional") parts.push("professional");
  if (typeof attrs.experience === "string") parts.push(attrs.experience);
  if (attrs.subject) parts.push(String(attrs.subject));
  if (attrs.specialty) parts.push(String(attrs.specialty));
  if (attrs.specialization) parts.push(String(attrs.specialization));
  if (attrs.mode === "mobile") parts.push("mobile");
  if (attrs.type) parts.push(formatType(String(attrs.type)));

  // Add the main type
  parts.push(formatType(capacityType));

  return parts.join(" ").trim();
}

function buildPathExpression(path: Record<string, unknown>): string {
  const parts: string[] = [];
  const requires = String(path.requires || "");

  // Add modifiers from path attributes
  if (path.subject) parts.push(String(path.subject));
  if (path.language) parts.push(String(path.language));
  if (path.specialty) parts.push(String(path.specialty));
  if (path.cuisine) parts.push(String(path.cuisine));
  if (path.skill) parts.push(String(path.skill));
  if (path.instrument) parts.push(String(path.instrument));
  if (path.type && path.type !== "rental")
    parts.push(formatType(String(path.type)));
  if (path.mode) parts.push(String(path.mode));
  if (path.condition) parts.push(String(path.condition));

  // Add the main requires type
  parts.push(formatType(requires));

  // Add task type if relevant
  if (path.task) {
    parts.push(formatType(String(path.task)));
  }

  return parts.join(" ").trim();
}

function formatType(type: string): string {
  // Convert snake_case to readable format
  return type
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .trim();
}

function transformExample(old: OldExample): NewExample {
  const expressions =
    old.type === "capacity"
      ? extractExpressionsFromCapacity(old)
      : extractExpressionsFromNeed(old);

  // Ensure we have at least one expression
  if (expressions.length === 0) {
    expressions.push(old.naturalLanguage.substring(0, 50));
  }

  // Deduplicate and limit
  const uniqueExpressions = [...new Set(expressions)].slice(0, 5);

  const result: NewExample = {
    id: old.id,
    category: old.category,
    naturalLanguage: old.naturalLanguage,
    type: old.type,
    expressions: uniqueExpressions.map((text) => ({ text })),
  };

  // Keep constraints if present (from structured.constraints)
  if (old.structured?.constraints) {
    result.constraints = old.structured.constraints;
  }

  // Keep shouldMatchWith and notes
  if (old.shouldMatchWith) {
    result.shouldMatchWith = old.shouldMatchWith;
  }
  if (old.notes) {
    result.notes = old.notes;
  }

  return result;
}

// Main execution
const inputPath = "./data/matching-examples.json";
const data = JSON.parse(readFileSync(inputPath, "utf-8")) as OldExample[];

console.log(`Transforming ${data.length} examples...`);

const transformed = data.map(transformExample);

// Summary
let capacityCount = 0;
let needCount = 0;
let totalExpressions = 0;

for (const ex of transformed) {
  if (ex.type === "capacity") capacityCount++;
  else needCount++;
  totalExpressions += ex.expressions.length;
}

console.log(`\nSummary:`);
console.log(`- Capacities: ${capacityCount}`);
console.log(`- Needs: ${needCount}`);
console.log(
  `- Total expressions generated: ${totalExpressions} (avg ${(totalExpressions / transformed.length).toFixed(1)} per example)`
);

// Show a few examples
console.log(`\nSample transformations:`);
for (const ex of transformed.slice(0, 3)) {
  console.log(`\n#${ex.id} (${ex.type}):`);
  console.log(`  NL: "${ex.naturalLanguage}"`);
  console.log(`  Expressions:`);
  for (const expr of ex.expressions) {
    console.log(`    - "${expr.text}"`);
  }
}

// Write output
writeFileSync(inputPath, JSON.stringify(transformed, null, 2));
console.log(`\nWritten to ${inputPath}`);
