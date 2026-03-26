import "dotenv/config";
import fs from "fs";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const BASE_URL = process.env.WEBSITE_BASE_URL || "https://blue-prod-01.bessig.com";
const TMP_DIR = path.join(__dirname, "tmp-site-pages");

const FALLBACK_URLS = [
  `${BASE_URL}/`,
  `${BASE_URL}/content/page/aboutus`,
  `${BASE_URL}/contact.php`,
  `${BASE_URL}/content/page/vending-solutions`,
];

function sanitizeFilename(url) {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/[^\w\d]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180);
}

async function fetchSitemapUrls() {
  const candidates = [
    `${BASE_URL}/sitemap.xml`,
    `${BASE_URL}/sitemap_index.xml`,
  ];

  for (const sitemapUrl of candidates) {
    try {
      const res = await axios.get(sitemapUrl, { timeout: 15000 });
      const xml = res.data;

      const matches = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].trim());

      const pageUrls = matches.filter(
        (u) =>
          u.startsWith(BASE_URL) &&
          !u.endsWith(".jpg") &&
          !u.endsWith(".png") &&
          !u.endsWith(".pdf") &&
          !u.includes("/cart") &&
          !u.includes("/checkout") &&
          !u.includes("/account") &&
          !u.includes("/search")
      );

      if (pageUrls.length) return [...new Set(pageUrls)];
    } catch (err) {
      // try next sitemap candidate
    }
  }

  return FALLBACK_URLS;
}

function htmlToCleanText(html, url) {
  const $ = cheerio.load(html);

  $("script, style, noscript, iframe, svg").remove();

  const title = $("title").first().text().trim();
  const h1 = $("h1").first().text().trim();

  const mainText = $("body").text();
  const clean = mainText
    .replace(/\s+/g, " ")
    .replace(/(Skip to content|Toggle navigation)/gi, "")
    .trim();

  return [
    `URL: ${url}`,
    title ? `Title: ${title}` : "",
    h1 ? `H1: ${h1}` : "",
    "",
    clean,
  ]
    .filter(Boolean)
    .join("\n");
}

async function fetchPageText(url) {
  const res = await axios.get(url, {
    timeout: 20000,
    headers: {
      "User-Agent": "BAISBot-Ingestion/1.0",
    },
  });

  return htmlToCleanText(res.data, url);
}

async function writePageFiles(urls) {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  const filepaths = [];

  for (const url of urls) {
    try {
      const text = await fetchPageText(url);

      if (!text || text.length < 300) continue;

      const filename = `${sanitizeFilename(url)}.md`;
      const filepath = path.join(TMP_DIR, filename);

      fs.writeFileSync(filepath, text, "utf8");
      filepaths.push(filepath);

      console.log(`Saved: ${url}`);
    } catch (err) {
      console.warn(`Failed: ${url} -> ${err.message}`);
    }
  }

  return filepaths;
}

async function uploadFiles(filepaths) {
  const fileIds = [];

  for (const filepath of filepaths) {
    const uploaded = await client.files.create({
      file: fs.createReadStream(filepath),
      purpose: "assistants",
    });

    fileIds.push(uploaded.id);
    console.log(`Uploaded: ${path.basename(filepath)} -> ${uploaded.id}`);
  }

  return fileIds;
}

async function getOrCreateVectorStore() {
  if (process.env.OPENAI_VECTOR_STORE_ID) {
    return process.env.OPENAI_VECTOR_STORE_ID;
  }

  const vectorStore = await client.vectorStores.create({
    name: "BAIS Website Knowledge Base",
  });

  console.log("\nNEW VECTOR STORE CREATED:");
  console.log(`OPENAI_VECTOR_STORE_ID=${vectorStore.id}\n`);

  return vectorStore.id;
}

async function attachFilesToVectorStore(vectorStoreId, fileIds) {
  const batch = await client.vectorStores.fileBatches.create(vectorStoreId, {
    file_ids: fileIds,
  });

  console.log(`Batch created: ${batch.id}`);
  return batch.id;
}

async function waitForBatch(vectorStoreId, batchId) {
  while (true) {
    const batch = await client.vectorStores.fileBatches.retrieve(vectorStoreId, batchId);
    console.log(`Batch status: ${batch.status}`, batch.file_counts);

    if (batch.status === "completed") return batch;
    if (batch.status === "failed" || batch.status === "cancelled") {
      throw new Error(`Batch ended with status: ${batch.status}`);
    }

    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const urls = await fetchSitemapUrls();
  console.log(`Found ${urls.length} URLs`);

  const filepaths = await writePageFiles(urls);
  console.log(`Prepared ${filepaths.length} files`);

  if (!filepaths.length) {
    throw new Error("No files created from website pages.");
  }

  const fileIds = await uploadFiles(filepaths);
  const vectorStoreId = await getOrCreateVectorStore();
  const batchId = await attachFilesToVectorStore(vectorStoreId, fileIds);

  await waitForBatch(vectorStoreId, batchId);

  console.log("\nDone.");
  console.log(`Use this in Render: OPENAI_VECTOR_STORE_ID=${vectorStoreId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
