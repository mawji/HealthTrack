import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readJson, writeJson, newId, dataPath, ensureDir } from "@/lib/store";
import { complete, hasAiKey } from "@/lib/openrouter";
import { extractLabReport, ParsedReport } from "@/lib/labs";
import { MedicalRecord } from "@/lib/types";
import { runMemoryWatchers } from "@/lib/memory-watchers";

const INDEX = "records-index.json";

/** Re-derive silent-watcher pattern memories after a record changes. Best-effort. */
function deriveMemories() {
  try {
    runMemoryWatchers();
  } catch (e) {
    console.error("Memory watchers failed:", e);
  }
}

async function extractPdfText(buf: Buffer, password?: string): Promise<string> {
  // pdf-parse ignores options.password (it passes the raw buffer to getDocument, never the options object).
  // Call the bundled pdfjs directly so we can pass { data, password }.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const PDFJS = require("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
  PDFJS.disableWorker = true;
  const params: any = { data: new Uint8Array(buf) };
  if (password) params.password = password;
  const doc = await PDFJS.getDocument(params);
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    let lastY: number | undefined;
    for (const item of (content as any).items) {
      if (lastY === item.transform[5] || lastY === undefined) {
        text += item.str;
      } else {
        text += "\n" + item.str;
      }
      lastY = item.transform[5];
    }
    text += "\n\n";
  }
  doc.destroy();
  return text;
}

async function extractText(buf: Buffer, mime: string, filename: string, password?: string): Promise<string> {
  if (mime === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
    return extractPdfText(buf, password);
  }
  if (mime.startsWith("text/") || /\.(txt|md|csv)$/i.test(filename)) {
    return buf.toString("utf8");
  }
  if (mime.startsWith("image/")) {
    if (!hasAiKey()) return "";
    // Vision model transcribes the document image.
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    return complete(
      [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe all text and values visible in this medical document image. Plain text only.",
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      { vision: true }
    );
  }
  return "";
}

async function summarize(text: string, filename: string): Promise<string> {
  if (!hasAiKey() || !text.trim()) {
    return text ? text.slice(0, 300) : `Uploaded file ${filename} (no text extracted).`;
  }
  return complete([
    {
      role: "user",
      content: `Summarize this medical record in 3-5 sentences for use as health-coach context. Capture: document type, date, key findings/values (with units and reference ranges if present), diagnoses, medications, and any follow-up instructions.\n\n---\n${text.slice(0, 12000)}`,
    },
  ]);
}

export async function GET() {
  const records = readJson<MedicalRecord[]>(INDEX, []);
  return NextResponse.json(records.slice().reverse());
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const password = (form.get("password") as string | null) || undefined;
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 15 MB)" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  let text = "";
  let summary = "";
  let parsed: ParsedReport | null = null;
  try {
    text = await extractText(buf, file.type, file.name, password);
    [summary, parsed] = await Promise.all([
      summarize(text, file.name),
      extractLabReport(text).catch((e) => {
        console.error("Structured extraction failed:", e);
        return null;
      }),
    ]);
  } catch (e: any) {
    const msg: string = e?.message ?? String(e);
    if (/no password|incorrect password/i.test(msg)) {
      return NextResponse.json(
        { error: "PDF_PASSWORD_REQUIRED", wrong: /incorrect password/i.test(msg) },
        { status: 422 }
      );
    }
    console.error("Record processing failed:", e);
    summary = `Uploaded ${file.name}; automatic analysis failed (${msg}).`;
  }

  const id = newId();
  const safeName = file.name.replace(/[^\w.\- ]/g, "_");
  ensureDir(dataPath("records"));
  fs.writeFileSync(path.join(dataPath("records"), `${id}-${safeName}`), buf);

  const record: MedicalRecord = {
    id,
    uploadedAt: new Date().toISOString(),
    filename: file.name,
    mimeType: file.type,
    summary,
    textExcerpt: text.slice(0, 800),
    docType: parsed?.docType ?? null,
    labName: parsed?.labName ?? null,
    reportDate: parsed?.reportDate ?? null,
    metrics: parsed?.metrics ?? [],
  };

  const records = readJson<MedicalRecord[]>(INDEX, []);
  records.push(record);
  writeJson(INDEX, records);
  deriveMemories();
  return NextResponse.json(record);
}

/** Re-runs text extraction + structured parsing on an already-uploaded file. */
export async function PUT(req: NextRequest) {
  const { id, password } = await req.json().catch(() => ({}));
  const records = readJson<MedicalRecord[]>(INDEX, []);
  const record = records.find((r) => r.id === id);
  if (!record) return NextResponse.json({ error: "Record not found" }, { status: 404 });

  const dir = dataPath("records");
  let stored: string | undefined;
  try {
    stored = fs.readdirSync(dir).find((f) => f.startsWith(`${id}-`));
  } catch {
    // dir missing — handled below
  }
  if (!stored) {
    return NextResponse.json({ error: "Original file no longer on disk" }, { status: 404 });
  }

  const buf = fs.readFileSync(path.join(dir, stored));
  try {
    const text = await extractText(buf, record.mimeType, record.filename, password);
    const [summary, parsed] = await Promise.all([
      summarize(text, record.filename),
      extractLabReport(text),
    ]);
    record.summary = summary;
    record.textExcerpt = text.slice(0, 800);
    record.docType = parsed?.docType ?? record.docType ?? null;
    record.labName = parsed?.labName ?? record.labName ?? null;
    record.reportDate = parsed?.reportDate ?? record.reportDate ?? null;
    record.metrics = parsed?.metrics ?? [];
  } catch (e: any) {
    const msg: string = e?.message ?? String(e);
    if (/no password|incorrect password/i.test(msg)) {
      return NextResponse.json(
        { error: "PDF_PASSWORD_REQUIRED", wrong: /incorrect password/i.test(msg) },
        { status: 422 }
      );
    }
    console.error("Re-parse failed:", e);
    return NextResponse.json({ error: `Re-analysis failed: ${msg}` }, { status: 500 });
  }

  writeJson(INDEX, records);
  deriveMemories();
  return NextResponse.json(record);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const records = readJson<MedicalRecord[]>(INDEX, []);
  writeJson(
    INDEX,
    records.filter((r) => r.id !== id)
  );
  deriveMemories();
  try {
    const dir = dataPath("records");
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(`${id}-`)) fs.unlinkSync(path.join(dir, f));
    }
  } catch {
    // index already updated; stray file is harmless
  }
  return NextResponse.json({ ok: true });
}
