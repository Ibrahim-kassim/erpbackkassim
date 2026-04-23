import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import * as quotationService from '../services/quotation.service';
import { createQuotationSchema } from '../validators/quotation.schema';
import { Quotation } from '../models/quotation.model';
import { RFQ } from '../models/rfq.model';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env';

const getUploadsRoots = () => {
    const currentUploads = path.join(process.cwd(), 'uploads', 'quotations');
    const parentUploads = path.resolve(process.cwd(), '..', 'uploads', 'quotations');
    return Array.from(new Set([currentUploads, parentUploads]));
};

const findExistingDocumentPath = (filename: string): string | null => {
    for (const root of getUploadsRoots()) {
        const candidate = path.join(root, filename);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
};

const resolveStoredFilename = (file: Express.Multer.File) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ext || '.bin';
    return `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
};

const getAttachmentBuffer = (attachment: { data?: Buffer }, filename: string): Buffer | null => {
    if (attachment.data && Buffer.isBuffer(attachment.data) && attachment.data.length > 0) {
        return attachment.data;
    }
    const legacyPath = findExistingDocumentPath(filename);
    if (!legacyPath) return null;
    return fs.readFileSync(legacyPath);
};

type ExtractionItemResult = {
    rfqItemId: string;
    description: string;
    unitPrice: number;
    confidence: number;
    sourceLine: string;
};

type ExtractionResult = {
    suggestedCount: number;
    items: ExtractionItemResult[];
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const normalizeText = (value: string) =>
    (value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const parsePositiveNumbersFromLine = (line: string) => {
    const matches = line.match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
    const values = matches
        .map((token) => Number(token.replace(/,/g, '')))
        .filter((value) => Number.isFinite(value) && value > 0);
    return values;
};

const chooseUnitPriceFromCandidates = (values: number[], qty: number) => {
    if (!values.length) return null;
    const tolerance = (value: number) => Math.max(1, value * 0.03);

    // If we can detect (unitPrice * qty ~= total) inside candidate values, prefer that.
    for (const candidate of values) {
        if (Math.abs(candidate - qty) <= 0.0001) continue;
        const hasLineTotal = values.some(
            (other) => other !== candidate && Math.abs(other - candidate * qty) <= tolerance(other)
        );
        if (hasLineTotal) return round2(candidate);
    }

    // If we only have totals but no explicit unit, infer unit from total/qty.
    if (qty > 0) {
        for (const value of values) {
            if (Math.abs(value - qty) <= 0.0001) continue;
            const inferred = value / qty;
            if (Number.isFinite(inferred) && inferred > 0) {
                // keep sane bounds to avoid weird invoice numbers (dates, refs, etc.)
                if (inferred < 1_000_000) return round2(inferred);
            }
        }
    }

    const nonQtyValues = values.filter((value) => Math.abs(value - qty) > 0.0001);
    if (nonQtyValues.length) return round2(nonQtyValues[0]);
    return round2(values[0]);
};

const extractPricingHeuristically = async (
    quotation: any,
    tenantId: string,
    text: string
): Promise<ExtractionResult> => {
    const effectiveTenantId = quotation.tenantId || tenantId;
    const rfq = await RFQ.findOne({ _id: quotation.rfqId, tenantId: effectiveTenantId, isDeleted: false }).lean();
    if (!rfq || !Array.isArray(rfq.items) || !rfq.items.length) {
        return { suggestedCount: 0, items: [] };
    }

    if (!text.trim()) {
        return { suggestedCount: 0, items: [] };
    }

    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, 2000);

    const extractionItems: ExtractionItemResult[] = [];

    for (const quotationItem of quotation.items || []) {
        const rfqItem = (rfq.items as any[]).find(
            (item) => String(item._id) === String(quotationItem.rfqItemId)
        );
        if (!rfqItem) continue;

        const description = String(rfqItem.description || '');
        const qty = Number(rfqItem.quantity || 0);
        if (!description || !(qty > 0)) continue;

        const descriptionTokens = normalizeText(description)
            .split(' ')
            .filter((token) => token.length > 1);
        if (!descriptionTokens.length) continue;

        let bestLine = '';
        let bestWindow = '';
        let bestScore = 0;

        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            const lineWindow = lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 2)).join(' ');
            const normalizedLine = normalizeText(lineWindow);
            if (!normalizedLine) continue;

            const matchedCount = descriptionTokens.reduce(
                (acc, token) => (normalizedLine.includes(token) ? acc + 1 : acc),
                0
            );
            const score = matchedCount / descriptionTokens.length;
            if (score > bestScore) {
                bestScore = score;
                bestLine = line;
                bestWindow = lineWindow;
            }
        }

        if (!bestLine || bestScore < 0.3) continue;

        const values = [
            ...parsePositiveNumbersFromLine(bestLine),
            ...parsePositiveNumbersFromLine(bestWindow),
        ];
        const uniqueValues = Array.from(new Set(values));
        const unitPrice = chooseUnitPriceFromCandidates(uniqueValues, qty);
        if (!(unitPrice && unitPrice > 0)) continue;

        extractionItems.push({
            rfqItemId: String(quotationItem.rfqItemId),
            description,
            unitPrice,
            confidence: round2(bestScore),
            sourceLine: (bestWindow || bestLine).slice(0, 220),
        });
    }

    return { suggestedCount: extractionItems.length, items: extractionItems };
};

const tryExtractPricingWithLlm = async (
    quotation: any,
    tenantId: string,
    text: string
): Promise<ExtractionResult | null> => {
    if (!config.openaiApiKey || !text.trim()) return null;

    const effectiveTenantId = quotation.tenantId || tenantId;
    const rfq = await RFQ.findOne({ _id: quotation.rfqId, tenantId: effectiveTenantId, isDeleted: false }).lean();
    if (!rfq || !Array.isArray(rfq.items) || !rfq.items.length) {
        return { suggestedCount: 0, items: [] };
    }

    const quotationItems = (quotation.items || []).map((item: any) => {
        const rfqItem = (rfq.items as any[]).find((entry) => String(entry._id) === String(item.rfqItemId));
        return {
            rfqItemId: String(item.rfqItemId),
            description: String(rfqItem?.description || ''),
            quantity: Number(rfqItem?.quantity || 0),
        };
    });

    const instructions = [
        'You extract unit prices from vendor quotation text.',
        'Output strict JSON only.',
        'Schema: {"items":[{"rfqItemId":"...","unitPrice":123.45,"confidence":0.87,"sourceLine":"..."}]}',
        'Only include rfqItemId values from the provided item list.',
        'Use positive numbers only for unitPrice.',
        'If unsure, omit the item.',
        'Confidence must be between 0 and 1.',
    ].join(' ');

    const input = [
        `RFQ items: ${JSON.stringify(quotationItems)}`,
        `Vendor document text: ${text.slice(0, 15000)}`,
    ].join('\n\n');

    const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.openaiApiKey}`,
        },
        body: JSON.stringify({
            model: config.openaiModel,
            instructions,
            input,
        }),
    });

    if (!response.ok) return null;

    const json = await response.json() as any;
    const textOutput =
        typeof json?.output_text === 'string'
            ? json.output_text
            : Array.isArray(json?.output)
                ? json.output
                    .flatMap((item: any) =>
                        Array.isArray(item?.content)
                            ? item.content
                                .filter((entry: any) => entry?.type === 'output_text' && typeof entry?.text === 'string')
                                .map((entry: any) => entry.text)
                            : []
                    )
                    .join('\n')
                : '';

    if (!textOutput.trim()) return null;

    let parsed: any;
    try {
        parsed = JSON.parse(textOutput);
    } catch {
        return null;
    }

    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    const validItemIds = new Set(quotationItems.map((item: { rfqItemId: string }) => item.rfqItemId));

    const normalized: ExtractionItemResult[] = items
        .map((item: any) => {
            const rfqItemId = String(item?.rfqItemId || '');
            const unitPrice = Number(item?.unitPrice);
            const confidence = Math.max(0, Math.min(1, Number(item?.confidence || 0.5)));
            const sourceLine = String(item?.sourceLine || '').slice(0, 220);

            const referenceItem = quotationItems.find((entry: { rfqItemId: string }) => entry.rfqItemId === rfqItemId);
            if (!referenceItem) return null;
            if (!validItemIds.has(rfqItemId)) return null;
            if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;

            return {
                rfqItemId,
                description: referenceItem.description,
                unitPrice: round2(unitPrice),
                confidence: round2(confidence),
                sourceLine,
            } as ExtractionItemResult;
        })
        .filter((item: ExtractionItemResult | null): item is ExtractionItemResult => item !== null);

    return { suggestedCount: normalized.length, items: normalized };
};

const extractPricingFromPdf = async (
    quotation: any,
    tenantId: string,
    pdfBuffer: Buffer
): Promise<ExtractionResult> => {
    let pdfParseFn: ((buffer: Buffer) => Promise<{ text?: string }>) | null = null;
    try {
        // Use require here to keep TypeScript happy even before dependency typings are installed.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const loaded = require('pdf-parse');
        pdfParseFn = (loaded.default || loaded) as (buffer: Buffer) => Promise<{ text?: string }>;
    } catch {
        return { suggestedCount: 0, items: [] };
    }

    if (!pdfParseFn) {
        return { suggestedCount: 0, items: [] };
    }

    const parsed = await pdfParseFn(pdfBuffer);
    const text = String(parsed?.text || '');

    const llmResult = await tryExtractPricingWithLlm(quotation, tenantId, text);
    if (llmResult && llmResult.items.length > 0) return llmResult;

    return extractPricingHeuristically(quotation, tenantId, text);
};

export const submitQuotation = asyncHandler(async (req: Request, res: Response) => {
    const validatedData = createQuotationSchema.parse(req.body);
    const quotation = await quotationService.createQuotation(validatedData, req.tenantId!);
    res.status(201).json({ data: quotation });
});

export const getRFQQuotations = asyncHandler(async (req: Request, res: Response) => {
    const { rfqId } = req.params;
    const quotations = await quotationService.getQuotationsByRFQ(rfqId, req.tenantId!);
    res.json({ data: quotations });
});

export const selectQuotation = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const quotation = await quotationService.selectQuotation(id, req.tenantId!);
    res.json({ data: quotation });
});

export const deleteQuotation = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    await quotationService.deleteQuotation(id, req.tenantId!);
    res.status(204).send();
});

export const uploadDocuments = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const files = ((req as any).files || []) as Express.Multer.File[];
    if (!files.length) {
        res.status(400).json({ error: 'No files uploaded' });
        return;
    }

    const quotation =
        await Quotation.findOne({ _id: id, tenantId: req.tenantId!, isDeleted: false }) ||
        await Quotation.findOne({ _id: id, isDeleted: false });
    if (!quotation) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
    }

    if (!quotation.attachments) quotation.attachments = [];

    const newAttachments = files.map((file) => {
        const storedFilename = resolveStoredFilename(file);
        const fileBuffer = (file as any).buffer;
        return {
            filename: storedFilename,
            originalFilename: file.originalname,
            url: `/uploads/quotations/${storedFilename}`,
            contentType: file.mimetype,
            size: file.size,
            data: Buffer.isBuffer(fileBuffer) ? fileBuffer : undefined,
            storage: Buffer.isBuffer(fileBuffer) ? 'db' : 'disk',
            uploadedAt: new Date(),
        };
    });

    quotation.attachments.push(...newAttachments as any);

    // Backward compatibility: keep pdfPath as the most recently uploaded PDF (if any)
    const lastPdf = [...newAttachments].reverse().find((a) => (a.contentType || '').toLowerCase() === 'application/pdf' || a.url.toLowerCase().endsWith('.pdf'));
    if (lastPdf) {
        quotation.pdfPath = lastPdf.url;
    }

    await quotation.save();

    res.json({
        data: {
            attachments: quotation.attachments,
            pdfPath: quotation.pdfPath,
        },
    });
});

export const extractDocumentPricing = asyncHandler(async (req: Request, res: Response) => {
    const { id, filename } = req.params;
    const safeFilename = path.basename(filename);

    const quotation =
        await Quotation.findOne({ _id: id, tenantId: req.tenantId!, isDeleted: false }) ||
        await Quotation.findOne({ _id: id, isDeleted: false });
    if (!quotation) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
    }

    const attachment = (quotation.attachments || []).find((item) => item.filename === safeFilename);
    if (!attachment) {
        res.status(404).json({ error: 'Document not found' });
        return;
    }

    const contentType = String(attachment.contentType || '').toLowerCase();
    const isPdf = contentType === 'application/pdf' || safeFilename.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
        res.status(400).json({ error: 'Pricing extraction is only supported for PDF documents' });
        return;
    }

    const pdfBuffer = getAttachmentBuffer(attachment, safeFilename);
    if (!pdfBuffer) {
        res.status(404).json({ error: 'Document file missing on server' });
        return;
    }

    let extraction: ExtractionResult = { suggestedCount: 0, items: [] };
    try {
        extraction = await extractPricingFromPdf(quotation, req.tenantId!, pdfBuffer);
    } catch {
        extraction = { suggestedCount: 0, items: [] };
    }

    res.json({ data: { extraction } });
});

export const uploadPdf = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
    }

    const quotation =
        await Quotation.findOne({ _id: id, tenantId: req.tenantId!, isDeleted: false }) ||
        await Quotation.findOne({ _id: id, isDeleted: false });
    if (!quotation) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
    }

    const storedFilename = resolveStoredFilename(file);
    const fileBuffer = (file as any).buffer;

    // Store the relative path to serve later (legacy field)
    quotation.pdfPath = `/uploads/quotations/${storedFilename}`;

    // Also store in attachments list so we support multiple docs going forward.
    if (!quotation.attachments) quotation.attachments = [];
    quotation.attachments.push({
        filename: storedFilename,
        originalFilename: file.originalname,
        url: quotation.pdfPath,
        contentType: file.mimetype,
        size: file.size,
        data: Buffer.isBuffer(fileBuffer) ? fileBuffer : undefined,
        storage: Buffer.isBuffer(fileBuffer) ? 'db' : 'disk',
        uploadedAt: new Date(),
    } as any);
    await quotation.save();

    res.json({ data: { pdfPath: quotation.pdfPath, attachments: quotation.attachments } });
});

export const getDocumentFile = asyncHandler(async (req: Request, res: Response) => {
    const { id, filename } = req.params;
    const safeFilename = path.basename(filename);

    const quotation =
        await Quotation.findOne({ _id: id, tenantId: req.tenantId!, isDeleted: false }) ||
        await Quotation.findOne({ _id: id, isDeleted: false });
    if (!quotation) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
    }

    const attachment = (quotation.attachments || []).find((item) => item.filename === safeFilename);
    if (!attachment) {
        res.status(404).json({ error: 'Document not found' });
        return;
    }

    const fileBuffer = getAttachmentBuffer(attachment, safeFilename);
    if (!fileBuffer) {
        res.status(404).json({ error: 'Document file missing on server' });
        return;
    }

    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (attachment.contentType) {
        res.setHeader('Content-Type', attachment.contentType);
    }
    res.send(fileBuffer);
});

export const deleteDocument = asyncHandler(async (req: Request, res: Response) => {
    const { id, filename } = req.params;
    const safeFilename = path.basename(filename);

    const quotation =
        await Quotation.findOne({ _id: id, tenantId: req.tenantId!, isDeleted: false }) ||
        await Quotation.findOne({ _id: id, isDeleted: false });
    if (!quotation) {
        res.status(404).json({ error: 'Quotation not found' });
        return;
    }

    const existingAttachments = quotation.attachments || [];
    const removed = existingAttachments.filter((item) => item.filename === safeFilename);
    const remaining = existingAttachments.filter((item) => item.filename !== safeFilename);
    const removedCount = existingAttachments.length - remaining.length;
    if (removedCount <= 0) {
        res.status(404).json({ error: 'Document not found' });
        return;
    }

    quotation.attachments = remaining as any;

    if ((quotation.pdfPath || '').includes(safeFilename)) {
        const nextPdf = [...remaining].reverse().find((item) =>
            (item.contentType || '').toLowerCase() === 'application/pdf' || item.url.toLowerCase().endsWith('.pdf')
        );
        quotation.pdfPath = nextPdf ? nextPdf.url : undefined;
    }

    await quotation.save();

    for (const removedAttachment of removed) {
        const hasDbData = removedAttachment?.data && Buffer.isBuffer(removedAttachment.data) && removedAttachment.data.length > 0;
        if (hasDbData) continue;
        for (const root of getUploadsRoots()) {
            const absolutePath = path.join(root, safeFilename);
            if (fs.existsSync(absolutePath)) {
                try {
                    fs.unlinkSync(absolutePath);
                } catch {
                    // ignore file removal errors after DB update
                }
            }
        }
    }

    res.json({ data: { attachments: quotation.attachments, pdfPath: quotation.pdfPath } });
});

