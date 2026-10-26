// Pure utilities (no upstream) under dev-tools.
import { f } from "../kit.js";

async function digest(algorithm, text, encoding) {
  const { createHash } = await import("node:crypto");
  return createHash(algorithm).update(text).digest(encoding);
}

export default [
  {
    category: "dev-tools",
    slug: "hash",
    displayName: "Hash",
    description: "Compute md5 / sha1 / sha256 / sha512 digests of a text.",
    tags: ["hash", "sha256", "md5", "utility"],
    endpoints: [
      {
        slug: "digest",
        displayName: "Digest",
        method: "GET",
        cacheTtl: 3600,
        bulkEnabled: true,
        fields: [
          f.req("text", { example: "halo", max: 10000 }),
          f.enm("algorithm", ["md5", "sha1", "sha256", "sha512"], { default: "sha256" }),
          f.enm("encoding", ["hex", "base64"], { default: "hex" }),
        ],
        handler: async ({ text, algorithm, encoding }) => ({ algorithm, encoding, digest: await digest(algorithm, text, encoding), length: text.length }),
      },
    ],
  },
  {
    category: "dev-tools",
    slug: "uuid",
    displayName: "UUID",
    description: "Generate random v4 UUIDs.",
    tags: ["uuid", "id", "utility"],
    endpoints: [
      {
        slug: "v4",
        displayName: "UUID v4",
        method: "GET",
        cacheTtl: 0,
        fields: [f.int("count", { default: 1, min: 1, max: 100 })],
        handler: ({ count }) => ({ count, uuids: Array.from({ length: count }, () => crypto.randomUUID()) }),
      },
    ],
  },
  {
    category: "dev-tools",
    slug: "text",
    displayName: "Text Tools",
    description: "Text statistics and URL slugs.",
    tags: ["text", "slug", "utility"],
    endpoints: [
      {
        slug: "stats",
        displayName: "Text Statistics",
        method: "POST",
        cacheTtl: 300,
        bulkEnabled: true,
        fields: [f.req("text", { max: 100000 })],
        handler: ({ text }) => ({
          characters: text.length,
          words: (text.trim().match(/\S+/g) ?? []).length,
          lines: text.split(/\r?\n/).length,
          sentences: (text.match(/[^.!?]+[.!?]+/g) ?? (text.trim() ? [text] : [])).length,
        }),
      },
      {
        slug: "slugify",
        displayName: "Slugify",
        method: "GET",
        cacheTtl: 3600,
        pathTemplate: ":text",
        fields: [f.req("text", { example: "Halo Dunia!", max: 500 })],
        handler: ({ text }) => ({ slug: text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") }),
      },
    ],
  },
];
