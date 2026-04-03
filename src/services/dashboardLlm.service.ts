import { config } from '../config/env';
import { copilotModuleCatalogText, CopilotModuleKey, resolveModuleKeyFallback } from './dashboardCopilotCapabilities.service';

type PromptClassification = {
    intent:
        | 'GREETING'
        | 'ASK_HELP'
        | 'NAVIGATE'
        | 'ASK'
        | 'CONTINUE_WORKFLOW'
        | 'RESUME_WORKFLOW'
        | 'CANCEL_WORKFLOW'
        | 'DRAW_CHART'
        | 'PREVIEW_CSV'
        | 'PREVIEW_PDF'
        | 'CREATE_RFQ'
        | 'CREATE_CATEGORY'
        | 'CREATE_UOM'
        | 'CREATE_AR_INVOICE'
        | 'CREATE_PURCHASE_ORDER'
        | 'CREATE_GRN'
        | 'CREATE_AP_INVOICE'
        | 'CREATE_AR_RECEIPT'
        | 'CREATE_AP_PAYMENT'
        | 'CREATE_CHART_ACCOUNT'
        | 'CREATE_FISCAL_YEAR'
        | 'CREATE_BUSINESS_PARTNER'
        | 'CREATE_PRODUCT'
        | 'FIELDS_MISSING';
    pageKey?:
        | 'DASHBOARD'
        | 'CHART_OF_ACCOUNTS'
        | 'JOURNAL_ENTRIES'
        | 'FISCAL_CALENDAR'
        | 'GENERAL_LEDGER'
        | 'FINANCIAL_STATEMENTS'
        | 'BUSINESS_PARTNERS'
        | 'RFQS'
        | 'PURCHASE_ORDERS'
        | 'GOODS_RECEIPTS'
        | 'AP_INVOICES'
        | 'AP_PAYMENTS'
        | 'AP_AGING'
        | 'AR_INVOICES'
        | 'AR_RECEIPTS'
        | 'AR_AGING'
        | 'PRODUCTS'
        | 'STOCK_OVERVIEW'
        | 'SETTINGS';
    moduleKey?: CopilotModuleKey;
    chartKey?: 'cash_flow' | 'document_throughput' | 'overdue_balances' | 'inventory_risk';
    previewKey?: 'dashboard_overview' | 'overdue_customers' | 'overdue_vendors' | 'recent_activity' | 'payables_risk_summary';
};

type StructuredResponse<T> = {
    output: T | null;
    usedLlm: boolean;
};

const hasOpenAi = () => Boolean(config.openaiApiKey);

const ALLOWED_INTENTS = new Set([
    'GREETING',
    'ASK_HELP',
    'NAVIGATE',
    'ASK',
    'CONTINUE_WORKFLOW',
    'RESUME_WORKFLOW',
    'CANCEL_WORKFLOW',
    'DRAW_CHART',
    'PREVIEW_CSV',
    'PREVIEW_PDF',
    'CREATE_RFQ',
    'CREATE_CATEGORY',
    'CREATE_UOM',
    'CREATE_AR_INVOICE',
    'CREATE_PURCHASE_ORDER',
    'CREATE_GRN',
    'CREATE_AP_INVOICE',
    'CREATE_AR_RECEIPT',
    'CREATE_AP_PAYMENT',
    'CREATE_CHART_ACCOUNT',
    'CREATE_FISCAL_YEAR',
    'CREATE_BUSINESS_PARTNER',
    'CREATE_PRODUCT',
    'FIELDS_MISSING',
] as const);

const ALLOWED_PAGE_KEYS = new Set([
    'DASHBOARD',
    'CHART_OF_ACCOUNTS',
    'JOURNAL_ENTRIES',
    'FISCAL_CALENDAR',
    'GENERAL_LEDGER',
    'FINANCIAL_STATEMENTS',
    'BUSINESS_PARTNERS',
    'RFQS',
    'PURCHASE_ORDERS',
    'GOODS_RECEIPTS',
    'AP_INVOICES',
    'AP_PAYMENTS',
    'AP_AGING',
    'AR_INVOICES',
    'AR_RECEIPTS',
    'AR_AGING',
    'PRODUCTS',
    'STOCK_OVERVIEW',
    'SETTINGS',
] as const);

const ALLOWED_MODULE_KEYS = new Set([
    'BUSINESS_PARTNERS',
    'PRODUCTS',
    'CATEGORIES',
    'UOMS',
    'AR_INVOICES',
    'AP_INVOICES',
    'AR_RECEIPTS',
    'AP_PAYMENTS',
    'RFQS',
    'PURCHASE_ORDERS',
    'GOODS_RECEIPTS',
    'CHART_ACCOUNTS',
    'FISCAL_YEARS',
] as const);

const ALLOWED_CHART_KEYS = new Set(['cash_flow', 'document_throughput', 'overdue_balances', 'inventory_risk'] as const);
const ALLOWED_PREVIEW_KEYS = new Set(['dashboard_overview', 'overdue_customers', 'overdue_vendors', 'recent_activity', 'payables_risk_summary'] as const);

const ERP_PAGE_CATALOG = [
    'DASHBOARD -> Dashboard',
    'CHART_OF_ACCOUNTS -> Chart of Accounts',
    'JOURNAL_ENTRIES -> Journal Entries',
    'FISCAL_CALENDAR -> Fiscal Calendar',
    'GENERAL_LEDGER -> General Ledger',
    'FINANCIAL_STATEMENTS -> Financial Statements',
    'BUSINESS_PARTNERS -> Business Partners',
    'RFQS -> RFQ / Quotations',
    'PURCHASE_ORDERS -> Purchase Orders',
    'GOODS_RECEIPTS -> Goods Receipts',
    'AP_INVOICES -> Vendor Bills',
    'AP_PAYMENTS -> Vendor Payments',
    'AP_AGING -> AP Aging',
    'AR_INVOICES -> Customer Invoices',
    'AR_RECEIPTS -> Customer Receipts',
    'AR_AGING -> AR Aging',
    'PRODUCTS -> Products',
    'STOCK_OVERVIEW -> Stock Overview',
    'SETTINGS -> Settings',
].join('; ');

const ERP_ACTION_CATALOG = [
    'CREATE_RFQ -> Request for Quotation',
    'CREATE_CATEGORY -> Inventory Category',
    'CREATE_UOM -> Unit of Measure',
    'CREATE_AR_INVOICE -> Customer Invoice',
    'CREATE_PURCHASE_ORDER -> Purchase Order',
    'CREATE_GRN -> Goods Receipt',
    'CREATE_AP_INVOICE -> Vendor Bill',
    'CREATE_AR_RECEIPT -> Customer Receipt',
    'CREATE_AP_PAYMENT -> Vendor Payment',
    'CREATE_CHART_ACCOUNT -> Chart of Account',
    'CREATE_FISCAL_YEAR -> Fiscal Year',
    'CREATE_BUSINESS_PARTNER -> Business Partner',
    'CREATE_PRODUCT -> Product or Service',
].join('; ');

const CLASSIFIER_INSTRUCTIONS = [
    'You classify ERP assistant prompts.',
    'Return strict JSON only.',
    'Allowed intent values: GREETING, ASK_HELP, NAVIGATE, ASK, CONTINUE_WORKFLOW, RESUME_WORKFLOW, CANCEL_WORKFLOW, DRAW_CHART, PREVIEW_CSV, PREVIEW_PDF, CREATE_RFQ, CREATE_CATEGORY, CREATE_UOM, CREATE_AR_INVOICE, CREATE_PURCHASE_ORDER, CREATE_GRN, CREATE_AP_INVOICE, CREATE_AR_RECEIPT, CREATE_AP_PAYMENT, CREATE_CHART_ACCOUNT, CREATE_FISCAL_YEAR, CREATE_BUSINESS_PARTNER, CREATE_PRODUCT, FIELDS_MISSING.',
    'Allowed pageKey values: DASHBOARD, CHART_OF_ACCOUNTS, JOURNAL_ENTRIES, FISCAL_CALENDAR, GENERAL_LEDGER, FINANCIAL_STATEMENTS, BUSINESS_PARTNERS, RFQS, PURCHASE_ORDERS, GOODS_RECEIPTS, AP_INVOICES, AP_PAYMENTS, AP_AGING, AR_INVOICES, AR_RECEIPTS, AR_AGING, PRODUCTS, STOCK_OVERVIEW, SETTINGS.',
    'Only set pageKey for NAVIGATE.',
    'Allowed moduleKey values: BUSINESS_PARTNERS, PRODUCTS, CATEGORIES, UOMS, AR_INVOICES, AP_INVOICES, AR_RECEIPTS, AP_PAYMENTS, RFQS, PURCHASE_ORDERS, GOODS_RECEIPTS, CHART_ACCOUNTS, FISCAL_YEARS.',
    'Set moduleKey whenever the user is asking about a module, exporting a module, charting a module, or asking for records from a module.',
    'Allowed chartKey values: cash_flow, document_throughput, overdue_balances, inventory_risk.',
    'Allowed previewKey values: dashboard_overview, overdue_customers, overdue_vendors, recent_activity, payables_risk_summary.',
    'Only set chartKey for DRAW_CHART and previewKey for PREVIEW_CSV or PREVIEW_PDF.',
    'If the user wants to open, go to, navigate to, or be taken to a page/module/screen, classify as NAVIGATE, not as a create action.',
    `ERP pages: ${ERP_PAGE_CATALOG}.`,
    `ERP create actions: ${ERP_ACTION_CATALOG}.`,
    `ERP modules: ${copilotModuleCatalogText}.`,
    'Prefer semantic understanding over keyword matching.',
    'If the user asks to open a module page, do not classify as a create action.',
    'If the user asks what this system is, how it works, what modules exist, or what the assistant can do, classify as ASK_HELP.',
    'If there is an active workflow and the user is supplying values, corrections, or the next requested details for that workflow, classify as CONTINUE_WORKFLOW.',
    'If the user wants to pick up a paused workflow, classify as RESUME_WORKFLOW.',
    'If the user wants to stop, dismiss, close, drop, or cancel the active workflow, classify as CANCEL_WORKFLOW.',
    'If the user asks an unrelated live ERP question while a workflow exists, classify it as ASK, not CONTINUE_WORKFLOW.',
].join(' ');

const ASSISTANT_INSTRUCTIONS = [
    'You are an ERP assistant.',
    'Be concise, helpful, and grounded in provided facts only.',
    'Never claim you created, posted, sent, approved, confirmed, cancelled, or deleted anything unless the factual context says so.',
    'If something is missing, ask clearly for it.',
    'Use plain English and keep the response compact.',
    'Organize answers clearly with short section labels, bullet points, or numbered steps when helpful.',
    'You may use light friendly emoji sparingly when it improves readability.',
    'Do not use markdown tables, code fences, or noisy pseudo-report formatting.',
    'Reply as clean readable text only.',
].join(' ');

const normalizeAssistantText = (text: string, fallback: string) => {
    const trimmed = text.trim();
    if (!trimmed) return fallback;

    // If the model drifts into markdown tables / noisy report formatting, fall back to the deterministic answer.
    const suspiciousMarkdown =
        /\|.*\|/.test(trimmed) ||
        /^#{1,6}\s/m.test(trimmed) ||
        /```/.test(trimmed) ||
        /inventory chart|inventory table|table:/i.test(trimmed) && /\|/.test(trimmed);

    if (suspiciousMarkdown) {
        return fallback;
    }

    return trimmed;
};

const extractOutputText = (json: any): string => {
    if (typeof json?.output_text === 'string') {
        return json.output_text;
    }

    const output = Array.isArray(json?.output) ? json.output : [];
    const texts = output.flatMap((item: any) =>
        Array.isArray(item?.content)
            ? item.content
                .filter((content: any) => content?.type === 'output_text' && typeof content?.text === 'string')
                .map((content: any) => content.text)
            : []
    );

    return texts.join('\n').trim();
};

async function callOpenAiJson<T>(instructions: string, input: string): Promise<StructuredResponse<T>> {
    if (!hasOpenAi()) {
        return { output: null, usedLlm: false };
    }

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

    if (!response.ok) {
        throw new Error(`OpenAI request failed with status ${response.status}`);
    }

    const json = await response.json();
    const text = extractOutputText(json);
    if (!text) {
        return { output: null, usedLlm: true };
    }

    try {
        return { output: JSON.parse(text) as T, usedLlm: true };
    } catch {
        return { output: null, usedLlm: true };
    }
}

function sanitizeClassification(output: PromptClassification | null | undefined): PromptClassification | null {
    if (!output || !ALLOWED_INTENTS.has(output.intent)) {
        return null;
    }

    const next: PromptClassification = { intent: output.intent };

    if (output.pageKey && ALLOWED_PAGE_KEYS.has(output.pageKey)) {
        next.pageKey = output.pageKey;
    }

    if (output.moduleKey && ALLOWED_MODULE_KEYS.has(output.moduleKey)) {
        next.moduleKey = output.moduleKey;
    }

    if (output.chartKey && ALLOWED_CHART_KEYS.has(output.chartKey)) {
        next.chartKey = output.chartKey;
    }

    if (output.previewKey && ALLOWED_PREVIEW_KEYS.has(output.previewKey)) {
        next.previewKey = output.previewKey;
    }

    return next;
}

export async function classifyDashboardPrompt(message: string, workflowSummary = '', conversationContext = ''): Promise<PromptClassification> {
    const fallback = classifyDashboardPromptFallback(message, conversationContext);

    try {
        const result = await callOpenAiJson<PromptClassification>(
            CLASSIFIER_INSTRUCTIONS,
            [
                `User message: ${message}`,
                `Current workflow: ${workflowSummary || 'none'}`,
                `Conversation context: ${conversationContext || 'none'}`,
                `Available pages: ${ERP_PAGE_CATALOG}`,
                `Available create actions: ${ERP_ACTION_CATALOG}`,
                `Available modules: ${copilotModuleCatalogText}`,
            ].join('\n')
        );

        return sanitizeClassification(result.output) || fallback;
    } catch {
        return fallback;
    }
}

export async function composeDashboardAssistantText(params: {
    userMessage: string;
    conversationContext: string;
    factualContext: string;
    defaultText: string;
}) {
    if (!hasOpenAi()) return params.defaultText;

    try {
        const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.openaiApiKey}`,
            },
            body: JSON.stringify({
                model: config.openaiModel,
                instructions: ASSISTANT_INSTRUCTIONS,
                input: [
                    `User message: ${params.userMessage}`,
                    `Conversation context: ${params.conversationContext}`,
                    `Facts: ${params.factualContext}`,
                    `Fallback draft response: ${params.defaultText}`,
                ].join('\n\n'),
            }),
        });

        if (!response.ok) return params.defaultText;
        const json = await response.json();
        const text = extractOutputText(json);
        return normalizeAssistantText(text || '', params.defaultText);
    } catch {
        return params.defaultText;
    }
}

function classifyDashboardPromptFallback(message: string, conversationContext = ''): PromptClassification {
    const normalized = message.toLowerCase();
    const moduleKey = resolveModuleKeyFallback(message) || resolveModuleKeyFallback(conversationContext);
    const hasContextualReference = /\b(them|those|that|it|these|same|this one|that one)\b/.test(normalized);

    if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(normalized)) {
        if (/(tell me about|about the system|what can you do|how does this system work|how this system work|explain the system|about this erp|what modules|how can you help)/.test(normalized)) {
            return { intent: 'ASK_HELP', moduleKey };
        }
        return { intent: 'GREETING' };
    }

    if (/(tell me about|about the system|what can you do|how does this system work|how this system work|explain the system|about this erp|what modules|how can you help)/.test(normalized)) {
        return { intent: 'ASK_HELP', moduleKey };
    }

    if (/(resume|continue|bring back|open the form again|continue the form|resume form)/.test(normalized)) {
        return { intent: 'RESUME_WORKFLOW' };
    }

    if (/(cancel|drop|discard|stop|close the form|forget the form|cancel form)/.test(normalized)) {
        return { intent: 'CANCEL_WORKFLOW' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(dashboard|home)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'DASHBOARD' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(chart of accounts|coa)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'CHART_OF_ACCOUNTS' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(journal entries|journal entry)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'JOURNAL_ENTRIES' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(fiscal calendar|fiscal year|financial year|periods)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'FISCAL_CALENDAR' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(general ledger|ledger)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'GENERAL_LEDGER' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(financial statements|statements)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'FINANCIAL_STATEMENTS' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(business partners|customers and vendors|vendors and customers|partner page)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'BUSINESS_PARTNERS' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(rfq|rfqs|request for quotation|quotations)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'RFQS' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(purchase order|purchase orders|\bpo\b)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'PURCHASE_ORDERS' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(goods receipt|goods receipts|grn)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'GOODS_RECEIPTS' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(vendor bill|vendor bills|ap invoice|ap invoices|payables invoices)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'AP_INVOICES' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(vendor payment|vendor payments|ap payment|ap payments)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'AP_PAYMENTS' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(ap aging|vendor aging|payables aging)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'AP_AGING' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(customer invoice|customer invoices|ar invoice|ar invoices|receivables invoices)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'AR_INVOICES' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(customer receipt|customer receipts|ar receipt|ar receipts)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'AR_RECEIPTS' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(ar aging|customer aging|receivables aging)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'AR_AGING' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(product page|products page|product master|products|services|inventory products)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'PRODUCTS' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(stock overview|stock page|inventory stock|stock)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'STOCK_OVERVIEW' };
    }

    if (/(navigate|go to|take me to|open|bring me to|show me).*(settings|setting page|configuration)/.test(normalized)) {
        return { intent: 'NAVIGATE', pageKey: 'SETTINGS' };
    }

    if (/(what fields|what.*missing|missing fields|what else do you need)/.test(normalized)) {
        return { intent: 'FIELDS_MISSING', moduleKey };
    }

    if (/^(name|title|vendor|customer|category|uom|account|amount|date|qty|quantity|price|cost|type|status|email|phone|tax)\b/.test(normalized) || /^(it is|it's|use|set|make it|change it to)\b/.test(normalized)) {
        return { intent: 'CONTINUE_WORKFLOW', moduleKey };
    }

    if (/(create|make|prepare).*(rfq|request for quotation|quotation request)/.test(normalized)) {
        return { intent: 'CREATE_RFQ' };
    }

    if (/(create|make|prepare).*(category|product category|inventory category)/.test(normalized)) {
        return { intent: 'CREATE_CATEGORY' };
    }

    if (/(create|make|prepare).*(uom|unit of measure|unit|measurement unit)/.test(normalized)) {
        return { intent: 'CREATE_UOM' };
    }

    if (/(create|make|prepare).*(purchase order|\bpo\b)/.test(normalized)) {
        return { intent: 'CREATE_PURCHASE_ORDER' };
    }

    if (/(create|make|prepare).*(goods receipt|grn|receipt note)/.test(normalized)) {
        return { intent: 'CREATE_GRN' };
    }

    if (/(create|make|prepare).*(vendor bill|ap invoice|supplier invoice|vendor invoice)/.test(normalized)) {
        return { intent: 'CREATE_AP_INVOICE' };
    }

    if (/(create|make|prepare).*(customer invoice|ar invoice|invoice for customer|sales invoice)/.test(normalized)) {
        return { intent: 'CREATE_AR_INVOICE' };
    }

    if (/(create|make|prepare).*(customer receipt|ar receipt|receipt from customer)/.test(normalized)) {
        return { intent: 'CREATE_AR_RECEIPT' };
    }

    if (/(create|make|prepare).*(vendor payment|ap payment|payment to vendor|supplier payment)/.test(normalized)) {
        return { intent: 'CREATE_AP_PAYMENT' };
    }

    if (/(create|make|prepare).*(chart of account|chart account|account in coa|ledger account|coa account)/.test(normalized)) {
        return { intent: 'CREATE_CHART_ACCOUNT' };
    }

    if (/(create|make|prepare).*(fiscal year|financial year)/.test(normalized)) {
        return { intent: 'CREATE_FISCAL_YEAR' };
    }

    if (/(create|make|prepare).*(business partner|customer|vendor|supplier)/.test(normalized)) {
        return { intent: 'CREATE_BUSINESS_PARTNER' };
    }

    if (/(create|make|prepare).*(product|service item|inventory item|item master|service master)/.test(normalized)) {
        return { intent: 'CREATE_PRODUCT' };
    }

    if (/(csv|excel|spreadsheet).*(overdue customer|customer aging|receivable)/.test(normalized)) {
        return { intent: 'PREVIEW_CSV', previewKey: 'overdue_customers', moduleKey: 'AR_INVOICES' };
    }

    if (/(csv|excel|spreadsheet).*(overdue vendor|payable|ap aging|vendor aging)/.test(normalized)) {
        return { intent: 'PREVIEW_CSV', previewKey: 'overdue_vendors', moduleKey: 'AP_INVOICES' };
    }

    if (/(csv|excel|spreadsheet).*(recent activity|recent documents)/.test(normalized)) {
        return { intent: 'PREVIEW_CSV', previewKey: 'recent_activity', moduleKey };
    }

    if (/(csv|excel|spreadsheet)/.test(normalized)) {
        if (hasContextualReference && moduleKey) {
            return { intent: 'PREVIEW_CSV', previewKey: 'dashboard_overview', moduleKey };
        }
        return { intent: 'PREVIEW_CSV', previewKey: 'dashboard_overview', moduleKey };
    }

    if (/(pdf).*(payables|payable risk|vendor risk|ap risk)/.test(normalized)) {
        return { intent: 'PREVIEW_PDF', previewKey: 'payables_risk_summary', moduleKey: 'AP_INVOICES' };
    }

    if (/\bpdf\b/.test(normalized)) {
        return { intent: 'PREVIEW_PDF', previewKey: 'payables_risk_summary', moduleKey };
    }

    if (/(draw|show|plot).*(cash|cash flow|cash movement)/.test(normalized)) {
        return { intent: 'DRAW_CHART', chartKey: 'cash_flow', moduleKey };
    }

    if (/(draw|show|plot).*(document|throughput|invoice|receipt|payment)/.test(normalized)) {
        return { intent: 'DRAW_CHART', chartKey: 'document_throughput', moduleKey };
    }

    if (/(draw|show|plot).*(overdue|aging|receivable|payable)/.test(normalized)) {
        return { intent: 'DRAW_CHART', chartKey: 'overdue_balances', moduleKey };
    }

    if (/(draw|show|plot).*(inventory|stock)/.test(normalized)) {
        return { intent: 'DRAW_CHART', chartKey: 'inventory_risk', moduleKey };
    }

    if (/(draw|show|plot).*(chart|graph)/.test(normalized)) {
        return { intent: 'DRAW_CHART', chartKey: 'cash_flow', moduleKey };
    }

    return { intent: 'ASK', moduleKey };
}
