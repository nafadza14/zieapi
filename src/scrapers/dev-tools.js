import { createHash, randomUUID } from "node:crypto";

export default [
  {
    category: "dev-tools",
    slug: "hash",
    displayName: "Hash",
    description: "Compute message digests (md5, sha1, sha256, sha512) of a text.",
    tags: ["hash", "sha256", "md5", "crypto", "utility"],
    endpoints: [
      {
        slug: "digest",
        displayName: "Digest",
        description: "Hash a text with the chosen algorithm.",
        method: "GET",
        cacheTtl: 3600,
        bulkEnabled: true,
        fields: [
          { name: "text", type: "string", required: true, description: "Input text", example: "halo", max: 10000 },
          { name: "algorithm", type: "string", required: false, default: "sha256", enum: ["md5", "sha1", "sha256", "sha512"], description: "Digest algorithm" },
          { name: "encoding", type: "string", required: false, default: "hex", enum: ["hex", "base64"], description: "Output encoding" },
        ],
        exampleResponse: { algorithm: "sha256", encoding: "hex", digest: "…", length: 4 },
        handler: ({ text, algorithm, encoding }) => ({
          algorithm,
          encoding,
          digest: createHash(algorithm).update(text).digest(encoding),
          length: text.length,
        }),
      },
    ],
  },
  {
    category: "dev-tools",
    slug: "uuid",
    displayName: "UUID",
    description: "Generate random v4 UUIDs.",
    tags: ["uuid", "id", "random", "utility"],
    endpoints: [
      {
        slug: "v4",
        displayName: "UUID v4",
        method: "GET",
        cacheTtl: 0,
        fields: [{ name: "count", type: "integer", required: false, default: 1, min: 1, max: 100, description: "How many UUIDs" }],
        exampleResponse: { count: 1, uuids: ["4b8c…"] },
        handler: ({ count }) => ({ count, uuids: Array.from({ length: count }, () => randomUUID()) }),
      },
    ],
  },
  {
    category: "dev-tools",
    slug: "text",
    displayName: "Text Tools",
    description: "Text statistics and slugify.",
    tags: ["text", "slug", "count", "utility"],
    endpoints: [
      {
        slug: "stats",
        displayName: "Text Statistics",
        method: "POST",
        cacheTtl: 300,
        bulkEnabled: true,
        fields: [{ name: "text", type: "string", required: true, description: "Text to analyse", max: 100000 }],
        exampleResponse: { characters: 11, words: 2, lines: 1, sentences: 1 },
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
        fields: [{ name: "text", type: "string", required: true, description: "Text to slugify", example: "Halo Dunia!", max: 500 }],
        exampleResponse: { slug: "halo-dunia" },
        handler: ({ text }) => ({
          slug: text
            .normalize("NFKD")
            .replace(/[̀-ͯ]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, ""),
        }),
      },
    ],
  },
];
