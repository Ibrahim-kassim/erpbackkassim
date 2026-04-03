import { Types } from 'mongoose';
import { z } from 'zod';
import { APInvoice } from '../models/apInvoice.model';
import { APPayment } from '../models/apPayment.model';
import { ARInvoice } from '../models/arInvoice.model';
import { ARReceipt } from '../models/arReceipt.model';
import { BusinessPartner } from '../models/businessPartner.model';
import { ChartOfAccount, AccountType } from '../models/chartOfAccount.model';
import { DashboardArtifact } from '../models/dashboardArtifact.model';
import { DashboardChatSession } from '../models/dashboardChatSession.model';
import { GRN } from '../models/grn.model';
import { Product } from '../models/inventory/product.model';
import { Category } from '../models/inventory/category.model';
import { Uom } from '../models/inventory/uom.model';
import { PurchaseOrder } from '../models/purchaseOrder.model';
import { SystemConfig } from '../models/systemConfig.model';
import { createAPInvoiceSchema } from '../validators/apInvoice.schema';
import { createAPPaymentSchema } from '../validators/apPayment.schema';
import { createARInvoiceSchema } from '../validators/arInvoice.schema';
import { createARReceiptSchema } from '../validators/arReceipt.schema';
import { createBusinessPartnerSchema } from '../validators/businessPartner.schema';
import { createAccountSchema } from '../validators/chartOfAccount.schema';
import { createFiscalYearSchema } from '../validators/fiscal.schema';
import { categorySchema, productSchema, uomSchema } from '../validators/inventory.schema';
import { createGRNSchema } from '../validators/grn.schema';
import { createRFQSchema } from '../validators/rfq.schema';
import type { DashboardChatActionDTO, DashboardChatMessageDTO } from '../validators/dashboardChat.schema';
import { getDashboardOverview, queryDashboard } from './dashboard.service';
import { assistantModuleRegistry, AssistantExecutionMode, AssistantFormType, getExecutionChoices } from './dashboardChat.registry';
import {
    buildCopilotModulePdfLines,
    CopilotModuleKey,
    extractCopilotModuleFilters,
    getCopilotModuleChart,
    getCopilotModuleDestination,
    getCopilotModuleSummary,
} from './dashboardCopilotCapabilities.service';
import { classifyDashboardPrompt, composeDashboardAssistantText } from './dashboardLlm.service';
import * as apInvoiceService from './apInvoice.service';
import * as apPaymentService from './apPayment.service';
import * as arInvoiceService from './arInvoice.service';
import * as arReceiptService from './arReceipt.service';
import * as businessPartnerService from './businessPartner.service';
import * as chartOfAccountService from './chartOfAccount.service';
import { fiscalService } from './fiscal.service';
import * as grnService from './grn.service';
import * as inventoryService from './inventory.service';
import * as purchaseOrderService from './purchaseOrder.service';
import * as rfqService from './rfq.service';

class ServiceError extends Error {
    code: string;
    details?: any;
    constructor(message: string, code = 'VALIDATION_ERROR', details?: any) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

type ChatBlock =
    | { type: 'text'; text: string }
    | { type: 'navigation'; title: string; destination: string; summary: string; autoNavigate?: boolean }
    | { type: 'chart'; title: string; subtitle?: string; chartKind: 'area' | 'bar'; data: any[]; series: Array<{ key: string; label: string; color: string }> }
    | { type: 'table_preview'; title: string; columns: string[]; rows: string[][] }
    | { type: 'csv_preview'; title: string; columns: string[]; rows: string[][]; artifactId: string; fileName: string }
    | { type: 'pdf_preview'; title: string; summary: string; artifactId: string; fileName: string }
    | { type: 'form_request'; status?: 'active' | 'paused' | 'superseded' | 'completed'; formType: AssistantFormType; title: string; description: string; values: Record<string, any>; options: Record<string, any>; missingFields: string[]; executionModes: Array<{ mode: AssistantExecutionMode; label: string; summary: string; style?: 'primary' | 'secondary' }>; defaultExecutionMode: AssistantExecutionMode }
    | { type: 'completed_form_summary'; formType: AssistantFormType; title: string; summary: string; recordNo?: string; executionMode?: AssistantExecutionMode }
    | { type: 'workflow_paused'; formType: AssistantFormType; summary: string; missingFields: string[] }
    | { type: 'workflow_resumed'; formType: AssistantFormType; summary: string }
    | { type: 'validation_summary'; title: string; missingFields: string[] }
    | { type: 'execution_preview'; title: string; detail: string; workflowId?: string; formType?: AssistantFormType; executionMode?: AssistantExecutionMode }
    | { type: 'task_paused'; workflowId: string; formType: AssistantFormType; summary: string }
    | { type: 'task_resumed'; workflowId: string; formType: AssistantFormType; summary: string }
    | { type: 'task_summary'; workflowId: string; formType: AssistantFormType; summary: string }
    | { type: 'dependency_prompt'; workflowId: string; formType: AssistantFormType; summary: string }
    | { type: 'action_summary'; title: string; detail: string }
    | { type: 'record_created'; entityType: 'CATEGORY' | 'UOM' | 'RFQ' | 'AR_INVOICE' | 'PURCHASE_ORDER' | 'GRN' | 'AP_INVOICE' | 'AR_RECEIPT' | 'AP_PAYMENT' | 'CHART_ACCOUNT' | 'FISCAL_YEAR' | 'BUSINESS_PARTNER' | 'PRODUCT'; recordId: string; recordNo: string; destination: string; summary: string };

type ChatTurn = {
    id: string;
    role: 'user' | 'assistant';
    createdAt: string;
    blocks: ChatBlock[];
};

type ChatSessionSummary = {
    id: string;
    title: string;
    preview: string;
    createdAt: string;
    updatedAt: string;
};

type PendingAction = {
    formType: AssistantFormType;
    values: Record<string, any>;
    options: Record<string, any>;
    executionModes: Array<{ mode: AssistantExecutionMode; label: string; summary: string; style?: 'primary' | 'secondary' }>;
    defaultExecutionMode: AssistantExecutionMode;
};

type WorkflowStatus = 'idle' | 'collecting_form' | 'awaiting_execution' | 'paused' | 'completed' | 'cancelled';

type WorkflowState = {
    status: WorkflowStatus;
    formType?: AssistantFormType;
    missingFields: string[];
    executionMode?: AssistantExecutionMode;
    summary?: string;
};

type WorkflowNodeStatus = 'collecting' | 'awaiting_confirm' | 'paused' | 'executing' | 'completed' | 'cancelled';

type WorkflowNode = PendingAction & {
    id: string;
    status: WorkflowNodeStatus;
    executionMode: AssistantExecutionMode;
    missingFields: string[];
    parentWorkflowId?: string | null;
    summary: string;
};

const isoNow = () => new Date().toISOString();
const makeId = () => new Types.ObjectId().toString();

const assistantNavigationMap = {
    DASHBOARD: { title: 'Dashboard', destination: '/dashboard' },
    CHART_OF_ACCOUNTS: { title: 'Chart of Accounts', destination: '/chart-of-accounts' },
    JOURNAL_ENTRIES: { title: 'Journal Entries', destination: '/journal-entries' },
    FISCAL_CALENDAR: { title: 'Fiscal Calendar', destination: '/fiscal-calendar' },
    GENERAL_LEDGER: { title: 'General Ledger', destination: '/general-ledger' },
    FINANCIAL_STATEMENTS: { title: 'Financial Statements', destination: '/statements' },
    BUSINESS_PARTNERS: { title: 'Business Partners', destination: '/business-partners' },
    RFQS: { title: 'RFQ / Quotations', destination: '/rfqs' },
    PURCHASE_ORDERS: { title: 'Purchase Orders', destination: '/purchase-orders' },
    GOODS_RECEIPTS: { title: 'Goods Receipts', destination: '/goods-receipts' },
    AP_INVOICES: { title: 'Vendor Bills', destination: '/ap-invoices' },
    AP_PAYMENTS: { title: 'Vendor Payments', destination: '/payments' },
    AP_AGING: { title: 'AP Aging', destination: '/ap-aging' },
    AR_INVOICES: { title: 'Customer Invoices', destination: '/receivables/invoices' },
    AR_RECEIPTS: { title: 'Customer Receipts', destination: '/receivables/receipts' },
    AR_AGING: { title: 'AR Aging', destination: '/receivables/aging' },
    PRODUCTS: { title: 'Products', destination: '/inventory/products' },
    STOCK_OVERVIEW: { title: 'Stock Overview', destination: '/inventory/stock' },
    SETTINGS: { title: 'Settings', destination: '/settings' },
} as const;

const mapSession = (session: any) => ({
    id: session._id?.toString() || session.id,
    title: session.title,
    turns: session.turns || [],
    pendingAction: session.pendingAction || null,
    conversationSummary: session.conversationSummary || '',
    workflowState: session.workflowState || session.workingState || null,
    workflowStack: session.workflowStack || [],
    activeWorkflowId: session.activeWorkflowId || null,
    workingState: session.workflowState || session.workingState || null,
    createdAt: session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt,
    updatedAt: session.updatedAt instanceof Date ? session.updatedAt.toISOString() : session.updatedAt,
});

const mapSessionSummary = (session: any): ChatSessionSummary => ({
    id: session._id?.toString() || session.id,
    title: session.title,
    preview: getSessionPreviewText(session.turns || []),
    createdAt: session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt,
    updatedAt: session.updatedAt instanceof Date ? session.updatedAt.toISOString() : session.updatedAt,
});

const asTurn = (role: 'user' | 'assistant', blocks: ChatBlock[]): ChatTurn => ({
    id: makeId(),
    role,
    createdAt: isoNow(),
    blocks,
});

const safeLower = (value?: string) => (value || '').toLowerCase();

function getWorkflowSummary(state?: WorkflowState | null) {
    if (!state || state.status === 'idle') return 'none';
    const formLabel = state.formType ? assistantModuleRegistry[state.formType]?.title || state.formType : 'workflow';
    const missing = state.missingFields?.length ? `missing: ${state.missingFields.join(', ')}` : 'all required fields filled';
    return `${state.status} ${formLabel}; ${missing}; mode: ${state.executionMode || 'SAVE'}`;
}

function getWorkflowFormDescription(formType: AssistantFormType) {
    switch (formType) {
        case 'CREATE_CATEGORY':
            return 'Create the inventory category first, then the assistant will return to the blocked parent task automatically.';
        case 'CREATE_UOM':
            return 'Create the unit of measure first, then the assistant will return to the blocked parent task automatically.';
        case 'CREATE_RFQ':
            return 'Review or complete the RFQ details below, then choose whether to save it or create and send it.';
        case 'CREATE_AR_INVOICE':
            return 'Review or complete the customer invoice details, then choose whether to save it or create and post it.';
        case 'CREATE_PURCHASE_ORDER':
            return 'Review or complete the purchase order details, then choose whether to save it or create and approve it.';
        case 'CREATE_GRN':
            return 'Review or complete the goods receipt details, then choose whether to save it or create and confirm it.';
        case 'CREATE_AP_INVOICE':
            return 'Review or complete the vendor bill details, then choose whether to save it or create and post it.';
        case 'CREATE_AR_RECEIPT':
            return 'Review or complete the customer receipt details, then choose whether to save it or create and post it.';
        case 'CREATE_AP_PAYMENT':
            return 'Review or complete the vendor payment details, then choose whether to save it or create and post it.';
        case 'CREATE_CHART_ACCOUNT':
            return 'Review or complete the chart of account details, then choose how you want to create it.';
        case 'CREATE_FISCAL_YEAR':
            return 'Review or complete the fiscal year details, then choose how you want to create it.';
        case 'CREATE_BUSINESS_PARTNER':
            return 'Review or complete the business partner details, then choose how you want to create it.';
        case 'CREATE_PRODUCT':
            return 'Review or complete the product or service details, then choose how you want to create it.';
        default:
            return 'Review the details and choose the action you want.';
    }
}

function computeMissingFields(formType: AssistantFormType, values: any) {
    switch (formType) {
        case 'CREATE_CATEGORY': return getCategoryMissingFields(values);
        case 'CREATE_UOM': return getUomMissingFields(values);
        case 'CREATE_RFQ': return getRfqMissingFields(values);
        case 'CREATE_AR_INVOICE': return getArInvoiceMissingFields(values);
        case 'CREATE_PURCHASE_ORDER': return getPurchaseOrderMissingFields(values);
        case 'CREATE_GRN': return getGrnMissingFields(values);
        case 'CREATE_AP_INVOICE': return getApInvoiceMissingFields(values);
        case 'CREATE_AR_RECEIPT': return getArReceiptMissingFields(values);
        case 'CREATE_AP_PAYMENT': return getApPaymentMissingFields(values);
        case 'CREATE_CHART_ACCOUNT': return getChartAccountMissingFields(values);
        case 'CREATE_FISCAL_YEAR': return getFiscalYearMissingFields(values);
        case 'CREATE_BUSINESS_PARTNER': return getBusinessPartnerMissingFields(values);
        case 'CREATE_PRODUCT': return getProductMissingFields(values);
        default: return [];
    }
}

function deriveWorkflowState(nextPendingAction?: PendingAction | null, missingFields: string[] = [], status?: WorkflowStatus | null): WorkflowState | null {
    if (!nextPendingAction) {
        return status && status !== 'idle'
            ? { status, missingFields: [], summary: 'No active workflow.' }
            : null;
    }

    const nextStatus = status || (missingFields.length ? 'collecting_form' : 'awaiting_execution');
    return {
        status: nextStatus,
        formType: nextPendingAction.formType,
        missingFields,
        executionMode: nextPendingAction.defaultExecutionMode,
        summary: `${assistantModuleRegistry[nextPendingAction.formType]?.title || nextPendingAction.formType} is ${nextStatus.replace(/_/g, ' ')}.`,
    };
}

function deriveWorkflowStateFromNode(node?: WorkflowNode | null): WorkflowState | null {
    if (!node) return { status: 'idle', missingFields: [], summary: 'No active workflow.' };
    return {
        status: node.status === 'collecting'
            ? 'collecting_form'
            : node.status === 'awaiting_confirm' || node.status === 'executing'
                ? 'awaiting_execution'
                : node.status,
        formType: node.formType,
        missingFields: node.missingFields,
        executionMode: node.executionMode,
        summary: node.summary,
    };
}

function getWorkflowStack(session: any): WorkflowNode[] {
    return Array.isArray(session.workflowStack) ? (session.workflowStack as WorkflowNode[]) : [];
}

function getActiveWorkflowNode(stack: WorkflowNode[], activeWorkflowId?: string | null) {
    if (!stack.length) return null;
    if (activeWorkflowId) {
        return stack.find((workflow) => workflow.id === activeWorkflowId) || null;
    }
    return stack.find((workflow) => workflow.status === 'collecting' || workflow.status === 'awaiting_confirm') || null;
}

function toPendingAction(workflow?: WorkflowNode | null): PendingAction | null {
    if (!workflow) return null;
    return {
        formType: workflow.formType,
        values: workflow.values,
        options: workflow.options,
        executionModes: workflow.executionModes,
        defaultExecutionMode: workflow.defaultExecutionMode,
    };
}

function upsertWorkflowNode(stack: WorkflowNode[], node: WorkflowNode) {
    const index = stack.findIndex((workflow) => workflow.id === node.id);
    if (index >= 0) {
        stack[index] = node;
    } else {
        stack.push(node);
    }
    return stack;
}

function syncSessionWorkflowState(session: any, stack: WorkflowNode[], activeWorkflowId?: string | null) {
    const activeWorkflow = getActiveWorkflowNode(stack, activeWorkflowId);
    session.workflowStack = stack;
    session.activeWorkflowId = activeWorkflow ? activeWorkflow.id : null;
    session.pendingAction = toPendingAction(activeWorkflow);
    session.workflowState = deriveWorkflowStateFromNode(activeWorkflow);
    session.workingState = session.workflowState;
}

function createWorkflowNode(params: {
    pendingAction: PendingAction;
    missingFields: string[];
    parentWorkflowId?: string | null;
    id?: string;
    status?: WorkflowNodeStatus;
    executionMode?: AssistantExecutionMode;
}): WorkflowNode {
    return {
        ...params.pendingAction,
        id: params.id || makeId(),
        status: params.status || (params.missingFields.length ? 'collecting' : 'awaiting_confirm'),
        executionMode: params.executionMode || params.pendingAction.defaultExecutionMode,
        missingFields: params.missingFields,
        parentWorkflowId: params.parentWorkflowId || null,
        summary: `${assistantModuleRegistry[params.pendingAction.formType]?.title || params.pendingAction.formType} is ${params.missingFields.length ? 'missing required details' : 'ready for confirmation'}.`,
    };
}

function getPausedWorkflowNodes(stack: WorkflowNode[]) {
    return stack.filter((workflow) => workflow.status === 'paused');
}

function shouldNestDependency(parentFormType: AssistantFormType, childFormType: AssistantFormType) {
    return (
        (parentFormType === 'CREATE_RFQ' && ['CREATE_PRODUCT', 'CREATE_UOM'].includes(childFormType)) ||
        (parentFormType === 'CREATE_PRODUCT' && ['CREATE_CATEGORY', 'CREATE_UOM'].includes(childFormType))
    );
}

function applyDependencyResultToParent(parent: WorkflowNode, child: WorkflowNode, created: { id: string; name?: string; code?: string; uomId?: string }) {
    if (parent.formType === 'CREATE_PRODUCT' && child.formType === 'CREATE_CATEGORY') {
        parent.values = { ...parent.values, categoryId: created.id };
    }
    if (parent.formType === 'CREATE_PRODUCT' && child.formType === 'CREATE_UOM') {
        parent.values = { ...parent.values, uomId: created.id };
    }
    if (parent.formType === 'CREATE_RFQ' && child.formType === 'CREATE_PRODUCT') {
        const items = Array.isArray(parent.values.items) && parent.values.items.length > 0
            ? [...parent.values.items]
            : [{ lineType: 'CATALOG', productId: '', description: '', quantity: 1, uomId: '' }];
        items[0] = {
            ...items[0],
            lineType: 'CATALOG',
            productId: created.id,
            description: created.name || items[0].description,
            uomId: created.uomId || items[0].uomId,
        };
        parent.values = { ...parent.values, items };
    }
    if (parent.formType === 'CREATE_RFQ' && child.formType === 'CREATE_UOM') {
        const items = Array.isArray(parent.values.items) && parent.values.items.length > 0
            ? [...parent.values.items]
            : [{ lineType: 'MANUAL', productId: '', description: '', quantity: 1, uomId: '' }];
        items[0] = { ...items[0], uomId: created.id };
        parent.values = { ...parent.values, items };
    }
}

function markLatestFormRequestStatus(session: any, status: 'paused' | 'superseded' | 'completed') {
    const turns = session.turns as ChatTurn[];
    for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
        const turn = turns[turnIndex];
        for (let blockIndex = turn.blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
            const block = turn.blocks[blockIndex] as ChatBlock;
            if (block.type === 'form_request' && (!block.status || block.status === 'active' || block.status === 'paused')) {
                block.status = status;
                return;
            }
        }
    }
}

function buildConversationContext(turns: ChatTurn[], summary = '') {
    const recentTurns = turns
        .slice(-4)
        .map((turn) => `${turn.role.toUpperCase()}: ${turn.blocks.map((block: any) => block.text || block.title || block.type).join(' | ')}`)
        .join('\n');

    return [summary ? `Conversation summary: ${summary}` : '', recentTurns].filter(Boolean).join('\n');
}

function summarizeTurnsForPrompt(turns: ChatTurn[]) {
    const olderTurns = turns.slice(0, -4);
    if (!olderTurns.length) return '';

    const summaryBits = olderTurns
        .slice(-8)
        .map((turn) => {
            const firstMeaningfulBlock = turn.blocks.find((block: any) => block.text || block.title || block.summary || block.detail) as any;
            const text = firstMeaningfulBlock?.text || firstMeaningfulBlock?.title || firstMeaningfulBlock?.summary || firstMeaningfulBlock?.detail || firstMeaningfulBlock?.type;
            return `${turn.role}: ${String(text).slice(0, 80)}`;
        })
        .join(' | ');

    return summaryBits.length > 600 ? `${summaryBits.slice(0, 597)}...` : summaryBits;
}

function compactFacts(facts: Record<string, any>) {
    return JSON.stringify(facts, (_key, value) => {
        if (Array.isArray(value)) {
            return value.slice(0, 8);
        }
        return value;
    });
}

function getSessionPreviewText(turns: ChatTurn[]) {
    const latestUserTurn = [...turns].reverse().find((turn) => turn.role === 'user');
    const latestTurn = latestUserTurn || [...turns].reverse()[0];
    if (!latestTurn) return 'No messages yet';

    const textBlock = latestTurn.blocks.find((block: any) => block.type === 'text' && typeof block.text === 'string') as { text?: string } | undefined;
    const preview = (textBlock?.text || latestTurn.blocks[0]?.type || 'New chat').trim();
    return preview.length > 72 ? `${preview.slice(0, 69)}...` : preview;
}

function deriveSessionTitle(message: string, currentTitle: string) {
    if (currentTitle && currentTitle !== 'Dashboard Copilot Session') return currentTitle;
    const cleaned = message.replace(/\s+/g, ' ').trim();
    if (!cleaned) return currentTitle;
    return cleaned.length > 36 ? `${cleaned.slice(0, 33)}...` : cleaned;
}

function escapePdfText(text: string) {
    return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildSimplePdf(title: string, lines: string[]) {
    const pageLines = [title, '', ...lines].slice(0, 38);
    let y = 790;
    const commands = ['BT', '/F1 16 Tf', '40 810 Td', `(${escapePdfText(pageLines[0])}) Tj`];
    commands.push('/F1 10 Tf');

    for (const line of pageLines.slice(1)) {
        y -= 18;
        commands.push(`1 0 0 1 40 ${y} Tm`);
        commands.push(`(${escapePdfText(line)}) Tj`);
    }
    commands.push('ET');

    const stream = commands.join('\n');
    const contentLength = Buffer.byteLength(stream, 'utf8');
    const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${contentLength} >> stream
${stream}
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000063 00000 n 
0000000122 00000 n 
0000000248 00000 n 
000000${String(260 + contentLength).padStart(10, '0')} 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
${325 + contentLength}
%%EOF`;

    return Buffer.from(pdf, 'utf8');
}

function buildCsv(columns: string[], rows: string[][]) {
    const escaped = [columns, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');
    return Buffer.from(escaped, 'utf8');
}

async function answerGroundedOperationalQuestion(tenantId: string, question: string, overview: Awaited<ReturnType<typeof getDashboardOverview>>) {
    const normalized = safeLower(question);

    if (/\binvoices?\b/.test(normalized)) {
        const [customerInvoices, vendorBills] = await Promise.all([
            ARInvoice.countDocuments({ tenantId, isDeleted: false }),
            APInvoice.countDocuments({ tenantId, isDeleted: false }),
        ]);

        const totalInvoices = customerInvoices + vendorBills;
        return {
            answer: `Yes. You currently have ${totalInvoices} invoice record(s): ${customerInvoices} customer invoice(s) and ${vendorBills} vendor bill(s) in this tenant.`,
            evidence: { customerInvoices, vendorBills, totalInvoices },
        };
    }

    if (/\bbusiness partners?\b|\bcustomers?\b|\bvendors?\b/.test(normalized)) {
        const [customers, vendors] = await Promise.all([
            BusinessPartner.countDocuments({ tenantId, isDeleted: false, roles: 'CUSTOMER', status: 'ACTIVE' }),
            BusinessPartner.countDocuments({ tenantId, isDeleted: false, roles: 'VENDOR', status: 'ACTIVE' }),
        ]);
        return {
            answer: `You currently have ${customers} active customer(s) and ${vendors} active vendor(s) in Business Partners.`,
            evidence: { customers, vendors },
        };
    }

    if (/\bproducts?\b|\bitems?\b/.test(normalized)) {
        const [products, services] = await Promise.all([
            Product.countDocuments({ tenantId, isDeleted: false, type: 'PRODUCT' }),
            Product.countDocuments({ tenantId, isDeleted: false, type: 'SERVICE' }),
        ]);
        return {
            answer: `You currently have ${products} product record(s) and ${services} service record(s) in inventory master data.`,
            evidence: { products, services },
        };
    }

    if (/\brfq\b|\bquotation/.test(normalized)) {
        const totalRfqs = await rfqService.getRFQList({ page: '1', limit: '1' }, tenantId).then((result) => result.meta.total).catch(() => 0);
        return {
            answer: `You currently have ${totalRfqs} RFQ record(s) in this tenant.`,
            evidence: { totalRfqs },
        };
    }

    if (/\bpurchase orders?\b|\bpo\b/.test(normalized)) {
        const totalPurchaseOrders = await PurchaseOrder.countDocuments({ tenantId, isDeleted: false });
        return {
            answer: `You currently have ${totalPurchaseOrders} purchase order record(s) in this tenant.`,
            evidence: { totalPurchaseOrders },
        };
    }

    if (/\bgoods receipts?\b|\bgrn\b/.test(normalized)) {
        const totalGoodsReceipts = await GRN.countDocuments({ tenantId, isDeleted: false });
        return {
            answer: `You currently have ${totalGoodsReceipts} goods receipt record(s) in this tenant.`,
            evidence: { totalGoodsReceipts },
        };
    }

    if (/\bsettings\b|\bdefaults?\b/.test(normalized)) {
        const config = await SystemConfig.findOne({ tenantId }).lean();
        return {
            answer: `Settings are configured with currency ${config?.currency || 'USD'} and VAT rate ${config?.vatRate ?? 0}%.`,
            evidence: { currency: config?.currency || 'USD', vatRate: config?.vatRate ?? 0 },
        };
    }

    return queryDashboard(tenantId, { question }).then((result) => ({
        answer: result.answer,
        evidence: result.evidence,
    }));
}

async function createArtifact(params: {
    tenantId: string;
    sessionId: string;
    kind: 'PDF' | 'CSV';
    title: string;
    fileName: string;
    mimeType: string;
    data: Buffer;
    preview?: any;
}) {
    const artifact = await DashboardArtifact.create({
        tenantId: params.tenantId,
        sessionId: new Types.ObjectId(params.sessionId),
        kind: params.kind,
        title: params.title,
        fileName: params.fileName,
        mimeType: params.mimeType,
        dataBase64: params.data.toString('base64'),
        preview: params.preview,
    });

    return artifact;
}

function bestEntityMatch<T extends { id: string; name?: string; code?: string }>(message: string, options: T[]) {
    const normalized = safeLower(message);
    const ranked = options
        .map((option) => {
            const code = safeLower(option.code);
            const name = safeLower(option.name);
            const score =
                (code && normalized.includes(code) ? code.length + 4 : 0) +
                (name && normalized.includes(name) ? name.length + 8 : 0);
            return { option, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);

    return ranked[0]?.option;
}

function inferQuantity(message: string) {
    const explicit = message.match(/(?:qty|quantity)\s*(?:of)?\s*(\d+(?:\.\d+)?)/i);
    if (explicit) return Number(explicit[1]);

    const generic = message.match(/\b(\d+(?:\.\d+)?)\b/);
    if (!generic) return undefined;
    const value = Number(generic[1]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
}

function inferUnitPrice(message: string) {
    const match = message.match(/(?:price|unit price|at)\s*(?:of)?\s*\$?(\d+(?:\.\d+)?)/i);
    return match ? Number(match[1]) : undefined;
}

function inferFreeTextName(message: string, fallback = '') {
    const quoted = message.match(/["“](.+?)["”]/);
    if (quoted?.[1]) return quoted[1].trim();

    const afterFor = message.match(/\bfor\s+([a-z0-9][a-z0-9 &/_-]{2,60})/i);
    if (afterFor?.[1]) return afterFor[1].trim();

    return fallback;
}

function inferAccountType(message: string): AccountType | undefined {
    const normalized = safeLower(message);
    if (normalized.includes('asset')) return AccountType.ASSET;
    if (normalized.includes('liability')) return AccountType.LIABILITY;
    if (normalized.includes('equity')) return AccountType.EQUITY;
    if (normalized.includes('expense')) return AccountType.EXPENSE;
    if (normalized.includes('revenue')) return AccountType.REVENUE;
    if (normalized.includes('income')) return AccountType.INCOME;
    if (normalized.includes('cash')) return AccountType.CASH;
    return undefined;
}

function inferAccountCode(message: string) {
    const match = message.match(/\b([A-Z0-9.-]{3,})\b/);
    return match?.[1];
}

function inferFiscalYearWindow(message: string) {
    const yearMatch = message.match(/\b(20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
    return {
        yearName: `FY ${year}`,
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
    };
}

const chatPoLineSchema = z.object({
    productId: z.string().optional(),
    uomId: z.string().optional(),
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().min(0),
    vatRate: z.number().min(0).max(100).default(0),
});

const createPOChatSchema = z.object({
    vendorId: z.string().min(1),
    orderDate: z.string().min(1),
    expectedDeliveryDate: z.string().optional(),
    currency: z.string().optional(),
    notes: z.string().optional(),
    lines: z.array(chatPoLineSchema).min(1),
});

type OptionPack =
    | 'vendors'
    | 'customers'
    | 'products'
    | 'uoms'
    | 'categories'
    | 'postingAccounts'
    | 'headerAccounts'
    | 'defaults'
    | 'approvedPurchaseOrders'
    | 'receivablePurchaseOrders'
    | 'outstandingArInvoices'
    | 'outstandingApInvoices';

async function loadFormOptions(tenantId: string, packs: OptionPack[]) {
    const requested = new Set(packs);
    const wantsDefaults = requested.has('defaults');
    const wantsPostingAccounts = requested.has('postingAccounts');
    const wantsHeaderAccounts = requested.has('headerAccounts');

    const [
        vendors,
        customers,
        products,
        uoms,
        categories,
        postingAccounts,
        headerAccounts,
        config,
        approvedPurchaseOrders,
        receivablePurchaseOrders,
        outstandingArInvoices,
        outstandingApInvoices,
    ] = await Promise.all([
        requested.has('vendors')
            ? BusinessPartner.find({ tenantId, isDeleted: false, status: 'ACTIVE', roles: 'VENDOR' }).select('code name').lean()
            : Promise.resolve([]),
        requested.has('customers')
            ? BusinessPartner.find({ tenantId, isDeleted: false, status: 'ACTIVE', roles: 'CUSTOMER' }).select('code name').lean()
            : Promise.resolve([]),
        requested.has('products')
            ? Product.find({ tenantId, isDeleted: false, status: 'ACTIVE' }).select('code name type unitPrice costPrice uomId inventoryTracked').lean()
            : Promise.resolve([]),
        requested.has('uoms')
            ? Uom.find({ tenantId, isDeleted: false, status: 'ACTIVE' }).select('name symbol').lean()
            : Promise.resolve([]),
        requested.has('categories')
            ? Category.find({ tenantId, isDeleted: false, status: 'ACTIVE' }).select('name').lean()
            : Promise.resolve([]),
        wantsPostingAccounts
            ? ChartOfAccount.find({ tenantId, isActive: true, isPosting: true }).select('code name type').lean()
            : Promise.resolve([]),
        wantsHeaderAccounts
            ? ChartOfAccount.find({ tenantId, isActive: true, isPosting: false }).select('code name type').lean()
            : Promise.resolve([]),
        wantsDefaults
            ? SystemConfig.findOne({ tenantId }).lean()
            : Promise.resolve(null),
        requested.has('approvedPurchaseOrders')
            ? PurchaseOrder.find({ tenantId, isDeleted: false, status: 'APPROVED' }).select('poNumber vendorId vendorName orderDate expectedDeliveryDate currency grandTotal receiptStatus billingStatus lines').sort({ createdAt: -1 }).lean()
            : Promise.resolve([]),
        requested.has('receivablePurchaseOrders')
            ? PurchaseOrder.find({ tenantId, isDeleted: false, status: 'APPROVED', receiptStatus: { $ne: 'FULLY_RECEIVED' } }).select('poNumber vendorId vendorName orderDate expectedDeliveryDate currency grandTotal receiptStatus billingStatus lines').sort({ createdAt: -1 }).lean()
            : Promise.resolve([]),
        requested.has('outstandingArInvoices')
            ? ARInvoice.find({ tenantId, isDeleted: false, status: 'POSTED', balance: { $gt: 0 } }).select('invoiceNo customerId customerName postingDate totals balance').lean()
            : Promise.resolve([]),
        requested.has('outstandingApInvoices')
            ? APInvoice.find({ tenantId, isDeleted: false, status: 'POSTED', balance: { $gt: 0 } }).select('invoiceNo vendorId vendorName postingDate totals balance').lean()
            : Promise.resolve([]),
    ]);

    return {
        vendors: (vendors as any[]).map((item: any) => ({ id: item._id.toString(), code: item.code, name: item.name, label: `${item.code} - ${item.name}` })),
        customers: (customers as any[]).map((item: any) => ({ id: item._id.toString(), code: item.code, name: item.name, label: `${item.code} - ${item.name}` })),
        products: (products as any[]).map((item: any) => ({ id: item._id.toString(), code: item.code, name: item.name, type: item.type, unitPrice: item.unitPrice, costPrice: item.costPrice, uomId: item.uomId?.toString?.() || '', inventoryTracked: Boolean(item.inventoryTracked), label: `${item.code} - ${item.name}` })),
        uoms: (uoms as any[]).map((item: any) => ({ id: item._id.toString(), name: item.name, symbol: item.symbol, label: `${item.symbol} - ${item.name}` })),
        categories: (categories as any[]).map((item: any) => ({ id: item._id.toString(), name: item.name, label: item.name })),
        revenueAccounts: (postingAccounts as any[]).filter((item: any) => item.type === AccountType.REVENUE || item.type === AccountType.INCOME).map((item: any) => ({ id: item._id.toString(), code: item.code, name: item.name, label: `${item.code} - ${item.name}` })),
        arAccounts: (postingAccounts as any[]).filter((item: any) => item.type === AccountType.ASSET).map((item: any) => ({ id: item._id.toString(), code: item.code, name: item.name, label: `${item.code} - ${item.name}` })),
        apAccounts: (postingAccounts as any[]).filter((item: any) => item.type === AccountType.LIABILITY).map((item: any) => ({ id: item._id.toString(), code: item.code, name: item.name, label: `${item.code} - ${item.name}` })),
        expenseAccounts: (postingAccounts as any[]).filter((item: any) => [AccountType.EXPENSE, AccountType.ASSET, AccountType.LIABILITY].includes(item.type)).map((item: any) => ({ id: item._id.toString(), code: item.code, name: item.name, label: `${item.code} - ${item.name}` })),
        paymentAccounts: (postingAccounts as any[]).filter((item: any) => [AccountType.ASSET, AccountType.CASH].includes(item.type)).map((item: any) => ({ id: item._id.toString(), code: item.code, name: item.name, label: `${item.code} - ${item.name}` })),
        headerAccounts: (headerAccounts as any[]).map((item: any) => ({ id: item._id.toString(), code: item.code, name: item.name, type: item.type, label: `${item.code} - ${item.name}` })),
        defaults: {
            accountsReceivable: (config as any)?.defaultAccounts?.accountsReceivable?.toString?.() || '',
            accountsPayable: (config as any)?.defaultAccounts?.accountsPayable?.toString?.() || '',
            cashAccount: (config as any)?.defaultAccounts?.cashAccount?.toString?.() || '',
            bankAccount: (config as any)?.defaultAccounts?.bankAccount?.toString?.() || '',
            currency: (config as any)?.currency || 'USD',
            vatRate: (config as any)?.vatRate ?? 0,
            paymentTermsOptions: (config as any)?.paymentTermsOptions || ['COD', 'Net 15', 'Net 30', 'Net 60'],
        },
        approvedPurchaseOrders: (approvedPurchaseOrders as any[]).map((po: any) => ({
            id: po._id.toString(),
            poNumber: po.poNumber,
            vendorId: po.vendorId?.toString(),
            vendorName: po.vendorName,
            grandTotal: po.grandTotal,
            currency: po.currency,
            receiptStatus: po.receiptStatus,
            billingStatus: po.billingStatus,
            label: `${po.poNumber} - ${po.vendorName}`,
            lines: (po.lines || []).map((line: any, index: number) => ({
                poLineIndex: index,
                productId: line.productId?.toString?.() || '',
                uomId: line.uomId?.toString?.() || '',
                description: line.description,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                vatRate: line.vatRate || 0,
                lineTotal: line.lineTotal,
            })),
        })),
        receivablePurchaseOrders: (receivablePurchaseOrders as any[]).map((po: any) => ({
            id: po._id.toString(),
            poNumber: po.poNumber,
            vendorId: po.vendorId?.toString(),
            vendorName: po.vendorName,
            grandTotal: po.grandTotal,
            currency: po.currency,
            receiptStatus: po.receiptStatus,
            billingStatus: po.billingStatus,
            label: `${po.poNumber} - ${po.vendorName}`,
            lines: (po.lines || []).map((line: any, index: number) => ({
                poLineIndex: index,
                productId: line.productId?.toString?.() || '',
                description: line.description,
                orderedQty: line.quantity,
                receivedQty: line.quantity,
                unitCost: line.unitPrice,
                lineTotal: line.lineTotal,
            })),
        })),
        outstandingArInvoices: (outstandingArInvoices as any[]).map((invoice: any) => ({
            id: invoice._id.toString(),
            customerId: invoice.customerId?.toString(),
            customerName: invoice.customerName,
            invoiceNo: invoice.invoiceNo,
            postingDate: invoice.postingDate instanceof Date ? invoice.postingDate.toISOString().split('T')[0] : invoice.postingDate,
            total: invoice.totals?.total || 0,
            outstanding: invoice.balance,
            label: `${invoice.invoiceNo} - ${invoice.customerName}`,
        })),
        outstandingApInvoices: (outstandingApInvoices as any[]).map((invoice: any) => ({
            id: invoice._id.toString(),
            vendorId: invoice.vendorId?.toString(),
            vendorName: invoice.vendorName,
            invoiceNo: invoice.invoiceNo,
            postingDate: invoice.postingDate instanceof Date ? invoice.postingDate.toISOString().split('T')[0] : invoice.postingDate,
            total: invoice.totals?.total || 0,
            outstanding: invoice.balance,
            label: `${invoice.invoiceNo} - ${invoice.vendorName}`,
        })),
    };
}

function buildFormRequestBlock(formType: AssistantFormType, payload: {
    title: string;
    description: string;
    values: Record<string, any>;
    options: Record<string, any>;
    missingFields: string[];
    status?: 'active' | 'paused' | 'superseded' | 'completed';
}): ChatBlock {
    const executionModes = getExecutionChoices(formType);
    return {
        type: 'form_request',
        status: payload.status || 'active',
        formType,
        title: payload.title,
        description: payload.description,
        values: payload.values,
        options: payload.options,
        missingFields: payload.missingFields,
        executionModes,
        defaultExecutionMode: executionModes[0]?.mode || 'SAVE',
    };
}

function buildPendingActionFormBlock(pendingAction: PendingAction, status: 'active' | 'paused' | 'superseded' | 'completed' = 'active') {
    return buildFormRequestBlock(pendingAction.formType, {
        title: assistantModuleRegistry[pendingAction.formType].title,
        description: getWorkflowFormDescription(pendingAction.formType),
        values: pendingAction.values,
        options: pendingAction.options,
        missingFields: computeMissingFields(pendingAction.formType, pendingAction.values),
        status,
    });
}

function getRfqMissingFields(values: any) {
    const missing: string[] = [];
    if (!values.title?.trim()) missing.push('Title');
    if (!Array.isArray(values.vendorIds) || values.vendorIds.length === 0) missing.push('Vendors');
    if (!Array.isArray(values.items) || values.items.length === 0) {
        missing.push('At least one item');
        return missing;
    }

    values.items.forEach((item: any, index: number) => {
        if (!item.description?.trim()) missing.push(`Item ${index + 1} description`);
        if (!item.uomId) missing.push(`Item ${index + 1} UOM`);
        if (!(Number(item.quantity) > 0)) missing.push(`Item ${index + 1} quantity`);
    });

    return missing;
}

function getArInvoiceMissingFields(values: any) {
    const missing: string[] = [];
    if (!values.customerId) missing.push('Customer');
    if (!values.invoiceDate) missing.push('Invoice date');
    if (!values.postingDate) missing.push('Posting date');
    if (!values.dueDate) missing.push('Due date');
    if (!values.accounting?.revenueAccountId) missing.push('Revenue account');
    if (!values.accounting?.arAccountId) missing.push('AR control account');
    if (!Array.isArray(values.items) || values.items.length === 0) {
        missing.push('At least one invoice item');
        return missing;
    }

    values.items.forEach((item: any, index: number) => {
        if (!item.description?.trim()) missing.push(`Line ${index + 1} description`);
        if (!(Number(item.quantity) > 0)) missing.push(`Line ${index + 1} quantity`);
        if (!(Number(item.unitPrice) >= 0)) missing.push(`Line ${index + 1} unit price`);
    });

    return missing;
}

function buildRfqFormPayload(values: any, options: any, missingFields: string[]): ChatBlock {
    return buildFormRequestBlock('CREATE_RFQ', {
        title: 'Create RFQ',
        description: 'Review or complete the RFQ details below, then choose whether to save it or create and send it.',
        values,
        options: {
            vendors: options.vendors,
            products: options.products,
            uoms: options.uoms,
        },
        missingFields,
    });
}

function buildArInvoiceFormPayload(values: any, options: any, missingFields: string[]): ChatBlock {
    return buildFormRequestBlock('CREATE_AR_INVOICE', {
        title: 'Create Customer Invoice',
        description: 'Review or complete the customer invoice details, then choose whether to save it or create and post it.',
        values,
        options: {
            customers: options.customers,
            products: options.products,
            revenueAccounts: options.revenueAccounts,
            arAccounts: options.arAccounts,
        },
        missingFields,
    });
}

function getChartAccountMissingFields(values: any) {
    const missing: string[] = [];
    if (!values.code?.trim()) missing.push('Account code');
    if (!values.name?.trim()) missing.push('Account name');
    if (!values.type) missing.push('Account type');
    if (typeof values.isPosting !== 'boolean') missing.push('Posting behavior');
    return missing;
}

function getFiscalYearMissingFields(values: any) {
    const missing: string[] = [];
    if (!values.yearName?.trim()) missing.push('Fiscal year name');
    if (!values.startDate) missing.push('Start date');
    if (!values.endDate) missing.push('End date');
    return missing;
}

function getBusinessPartnerMissingFields(values: any) {
    const missing: string[] = [];
    if (!values.name?.trim()) missing.push('Partner name');
    if (!Array.isArray(values.roles) || values.roles.length === 0) missing.push('Role');
    return missing;
}

function getCategoryMissingFields(values: any) {
    const missing: string[] = [];
    if (!values.name?.trim()) missing.push('Category name');
    return missing;
}

function getUomMissingFields(values: any) {
    const missing: string[] = [];
    if (!values.name?.trim()) missing.push('UOM name');
    if (!values.symbol?.trim()) missing.push('UOM symbol');
    return missing;
}

function getProductMissingFields(values: any) {
    const missing: string[] = [];
    if (!values.name?.trim()) missing.push('Name');
    if (!values.type) missing.push('Type');
    if (!values.categoryId) missing.push('Category');
    if (!values.uomId) missing.push('UOM');
    if (values.unitPrice === undefined || values.unitPrice === null || Number(values.unitPrice) < 0) missing.push('Unit price');
    if (values.type === 'PRODUCT' && (values.costPrice === undefined || values.costPrice === null || Number(values.costPrice) < 0)) missing.push('Cost price');
    return missing;
}

function getPurchaseOrderMissingFields(values: any) {
    const missing: string[] = [];
    if (!values.vendorId) missing.push('Vendor');
    if (!values.orderDate) missing.push('Order date');
    if (!Array.isArray(values.lines) || values.lines.length === 0) {
        missing.push('At least one PO line');
        return missing;
    }

    values.lines.forEach((item: any, index: number) => {
        if (!item.description?.trim()) missing.push(`PO line ${index + 1} description`);
        if (!(Number(item.quantity) > 0)) missing.push(`PO line ${index + 1} quantity`);
        if (!(Number(item.unitPrice) >= 0)) missing.push(`PO line ${index + 1} unit price`);
    });
    return missing;
}

function getGrnMissingFields(values: any) {
    const missing: string[] = [];
    if (!values.poId) missing.push('Purchase order');
    if (!values.receiptDate) missing.push('Receipt date');
    if (!Array.isArray(values.lines) || !values.lines.some((line: any) => Number(line.receivedQty) > 0)) {
        missing.push('At least one receipt line');
    }
    return missing;
}

function getApInvoiceMissingFields(values: any) {
    const missing: string[] = [];
    if (!values.vendorId) missing.push('Vendor');
    if (!values.invoiceDate) missing.push('Invoice date');
    if (!values.postingDate) missing.push('Posting date');
    if (!values.accounting?.expenseAccountId) missing.push('Debit account');
    if (!values.accounting?.apAccountId) missing.push('AP account');
    if (!Array.isArray(values.items) || values.items.length === 0) {
        missing.push('At least one vendor bill line');
        return missing;
    }

    values.items.forEach((item: any, index: number) => {
        if (!item.description?.trim()) missing.push(`Bill line ${index + 1} description`);
        if (!(Number(item.quantity) > 0)) missing.push(`Bill line ${index + 1} quantity`);
        if (!(Number(item.unitPrice) >= 0)) missing.push(`Bill line ${index + 1} unit price`);
    });
    return missing;
}

function getArReceiptMissingFields(values: any) {
    const missing: string[] = [];
    if (!values.customerId) missing.push('Customer');
    if (!values.receiptDate) missing.push('Receipt date');
    if (!values.postingDate) missing.push('Posting date');
    if (!values.bankAccountId) missing.push('Bank / cash account');
    if (!values.arAccountId) missing.push('AR control account');
    if (!(Number(values.amount) > 0)) missing.push('Receipt amount');
    return missing;
}

function getApPaymentMissingFields(values: any) {
    const missing: string[] = [];
    if (!values.vendorId) missing.push('Vendor');
    if (!values.paymentDate) missing.push('Payment date');
    if (!values.postingDate) missing.push('Posting date');
    if (!values.paymentAccountId) missing.push('Payment account');
    if (!values.apAccountId) missing.push('AP control account');
    if (!(Number(values.amount) > 0)) missing.push('Payment amount');
    return missing;
}

function buildPurchaseOrderFormPayload(values: any, options: any, missingFields: string[]): ChatBlock {
    return buildFormRequestBlock('CREATE_PURCHASE_ORDER', {
        title: 'Create Purchase Order',
        description: 'Review the purchase order and choose whether to save it or create and approve it.',
        values,
        options: {
            vendors: options.vendors,
            products: options.products,
            uoms: options.uoms,
            currency: options.defaults.currency,
        },
        missingFields,
    });
}

function buildGrnFormPayload(values: any, options: any, missingFields: string[]): ChatBlock {
    return buildFormRequestBlock('CREATE_GRN', {
        title: 'Create Goods Receipt',
        description: 'Review the receipt lines and choose whether to save the GRN or create and confirm it.',
        values,
        options: {
            purchaseOrders: options.receivablePurchaseOrders,
        },
        missingFields,
    });
}

function buildApInvoiceFormPayload(values: any, options: any, missingFields: string[]): ChatBlock {
    return buildFormRequestBlock('CREATE_AP_INVOICE', {
        title: 'Create Vendor Bill',
        description: 'Review the vendor bill and choose whether to save it or create and post it.',
        values,
        options: {
            vendors: options.vendors,
            approvedPurchaseOrders: options.approvedPurchaseOrders,
            expenseAccounts: options.expenseAccounts,
            apAccounts: options.apAccounts,
            currency: options.defaults.currency,
        },
        missingFields,
    });
}

function buildArReceiptFormPayload(values: any, options: any, missingFields: string[]): ChatBlock {
    return buildFormRequestBlock('CREATE_AR_RECEIPT', {
        title: 'Create Customer Receipt',
        description: 'Review the customer receipt and choose whether to save it or create and post it.',
        values,
        options: {
            customers: options.customers,
            arAccounts: options.arAccounts,
            paymentAccounts: options.paymentAccounts,
            outstandingInvoices: options.outstandingArInvoices,
            currency: options.defaults.currency,
        },
        missingFields,
    });
}

function buildApPaymentFormPayload(values: any, options: any, missingFields: string[]): ChatBlock {
    return buildFormRequestBlock('CREATE_AP_PAYMENT', {
        title: 'Create Vendor Payment',
        description: 'Review the vendor payment and choose whether to save it or create and post it.',
        values,
        options: {
            vendors: options.vendors,
            apAccounts: options.apAccounts,
            paymentAccounts: options.paymentAccounts,
            outstandingBills: options.outstandingApInvoices,
            currency: options.defaults.currency,
        },
        missingFields,
    });
}

function buildChartAccountFormPayload(values: any, options: any, missingFields: string[]): ChatBlock {
    return buildFormRequestBlock('CREATE_CHART_ACCOUNT', {
        title: 'Create Chart of Account',
        description: 'Set up a new account or header folder in the chart of accounts using the same validation rules as the accounting module.',
        values,
        options: {
            accountTypes: Object.values(AccountType),
            headerAccounts: options.headerAccounts,
        },
        missingFields,
    });
}

function buildFiscalYearFormPayload(values: any, missingFields: string[]): ChatBlock {
    return buildFormRequestBlock('CREATE_FISCAL_YEAR', {
        title: 'Create Fiscal Year',
        description: 'Review the fiscal year dates and whether monthly periods should be generated automatically.',
        values,
        options: {},
        missingFields,
    });
}

function buildBusinessPartnerFormPayload(values: any, options: any, missingFields: string[]): ChatBlock {
    return buildFormRequestBlock('CREATE_BUSINESS_PARTNER', {
        title: 'Create Business Partner',
        description: 'Create a customer, vendor, or dual-role partner using the live business partner rules in ERP KASSIM.',
        values,
        options: {
            paymentTermsOptions: options.defaults.paymentTermsOptions,
            currencies: [options.defaults.currency, 'USD', 'AED', 'EUR'],
        },
        missingFields,
    });
}

function buildCategoryFormPayload(values: any, missingFields: string[], status: 'active' | 'paused' | 'superseded' | 'completed' = 'active'): ChatBlock {
    return buildFormRequestBlock('CREATE_CATEGORY', {
        title: 'Create Category',
        description: 'Create the missing inventory category, then the assistant will return to the blocked parent task.',
        values,
        options: {},
        missingFields,
        status,
    });
}

function buildUomFormPayload(values: any, missingFields: string[], status: 'active' | 'paused' | 'superseded' | 'completed' = 'active'): ChatBlock {
    return buildFormRequestBlock('CREATE_UOM', {
        title: 'Create UOM',
        description: 'Create the missing unit of measure, then the assistant will return to the blocked parent task.',
        values,
        options: {},
        missingFields,
        status,
    });
}

function buildProductFormPayload(values: any, options: any, missingFields: string[]): ChatBlock {
    return buildFormRequestBlock('CREATE_PRODUCT', {
        title: 'Create Product / Service',
        description: 'Create an inventory product or service master using the same category, UOM, and pricing rules as the inventory module.',
        values,
        options: {
            categories: options.categories,
            uoms: options.uoms,
        },
        missingFields,
    });
}

function buildChartBlock(overview: any, chartKey: string | undefined): ChatBlock {
    if (chartKey === 'document_throughput') {
        return {
            type: 'chart',
            title: 'Document Throughput',
            subtitle: 'Live monthly document activity from the ERP.',
            chartKind: 'bar',
            data: overview.trends.documents,
            series: [
                { key: 'customerInvoices', label: 'Customer Invoices', color: '#2563eb' },
                { key: 'vendorBills', label: 'Vendor Bills', color: '#0f766e' },
                { key: 'customerReceipts', label: 'Customer Receipts', color: '#7c3aed' },
                { key: 'vendorPayments', label: 'Vendor Payments', color: '#ea580c' },
                { key: 'goodsReceipts', label: 'Goods Receipts', color: '#475569' },
            ],
        };
    }

    if (chartKey === 'overdue_balances') {
        return {
            type: 'chart',
            title: 'Overdue Balance Comparison',
            subtitle: 'Current overdue customer and vendor exposure.',
            chartKind: 'bar',
            data: [
                { bucket: 'Overdue AR', amount: overview.kpis.overdueReceivables },
                { bucket: 'Overdue AP', amount: overview.kpis.overduePayables },
            ],
            series: [{ key: 'amount', label: 'Amount', color: '#dc2626' }],
        };
    }

    if (chartKey === 'inventory_risk') {
        return {
            type: 'chart',
            title: 'Inventory Risk Snapshot',
            subtitle: 'Stock health based on current live inventory records.',
            chartKind: 'bar',
            data: [
                { bucket: 'In Stock', amount: overview.operations.inStockProducts },
                { bucket: 'Low Stock', amount: overview.operations.lowStockProducts },
                { bucket: 'Out of Stock', amount: overview.operations.outOfStockProducts },
            ],
            series: [{ key: 'amount', label: 'Products', color: '#2563eb' }],
        };
    }

    return {
        type: 'chart',
        title: 'Cash Movement',
        subtitle: 'Posted receipts and vendor payments over the last six months.',
        chartKind: 'area',
        data: overview.trends.cashFlow,
        series: [
            { key: 'cashIn', label: 'Cash In', color: '#0f766e' },
            { key: 'cashOut', label: 'Cash Out', color: '#b45309' },
            { key: 'netCash', label: 'Net Cash', color: '#2563eb' },
        ],
    };
}

async function buildCsvPreview(tenantId: string, sessionId: string, previewKey: string | undefined) {
    const today = new Date();

    if (previewKey === 'dashboard_overview' || !previewKey) {
        const overview = await getDashboardOverview(tenantId);
        const columns = ['Section', 'Metric', 'Value', 'Context'];
        const dataRows = [
            ['KPIs', 'Open Receivables', String(overview.kpis.openReceivables), 'Current open customer balances'],
            ['KPIs', 'Overdue Receivables', String(overview.kpis.overdueReceivables), 'Past-due customer exposure'],
            ['KPIs', 'Open Payables', String(overview.kpis.openPayables), 'Current open vendor balances'],
            ['KPIs', 'Overdue Payables', String(overview.kpis.overduePayables), 'Past-due vendor exposure'],
            ['KPIs', 'Inventory Value', String(overview.kpis.inventoryValue), 'Current stock valuation'],
            ['KPIs', 'Net Cash This Month', String(overview.kpis.netCashMonth), 'Posted receipts minus posted vendor payments'],
            ['Operations', 'RFQs Sent', String(overview.operations.sentRfqs), 'RFQs currently awaiting vendor response'],
            ['Operations', 'POs Awaiting Receipt', String(overview.operations.approvedPOAwaitingReceiptCount), 'Approved purchase orders with goods not yet received'],
            ['Operations', 'POs Awaiting Billing', String(overview.operations.approvedPOAwaitingBillingCount), 'Approved purchase orders not yet billed by vendors'],
            ['Operations', 'Low Stock Products', String(overview.operations.lowStockProducts), 'Products below their stock threshold'],
            ['Operations', 'Out of Stock Products', String(overview.operations.outOfStockProducts), 'Products with zero on-hand quantity'],
            ...overview.attention.slice(0, 8).map((item: any) => ['Attention', item.title, item.metric || item.severity, item.detail]),
        ];

        const artifact = await createArtifact({
            tenantId,
            sessionId,
            kind: 'CSV',
            title: 'Dashboard Overview',
            fileName: 'dashboard-overview.csv',
            mimeType: 'text/csv',
            data: buildCsv(columns, dataRows),
            preview: { columns, rows: dataRows },
        });

        return {
            text: 'I prepared a spreadsheet-style export of the live dashboard overview. If you want a more specific file next, ask for overdue customers, overdue vendors, or recent activity.',
            block: { type: 'csv_preview', title: 'Dashboard Overview Export', columns, rows: dataRows.slice(0, 12), artifactId: artifact._id.toString(), fileName: artifact.fileName } as ChatBlock,
        };
    }

    if (previewKey === 'overdue_vendors') {
        const rows = await APInvoice.find({ tenantId, isDeleted: false, status: 'POSTED', balance: { $gt: 0 }, dueDate: { $lt: today } })
            .sort({ dueDate: 1 })
            .limit(20)
            .select('invoiceNo vendorName dueDate balance')
            .lean();

        const columns = ['Bill No', 'Vendor', 'Due Date', 'Balance'];
        const dataRows = rows.map((row: any) => [row.invoiceNo, row.vendorName, new Date(row.dueDate).toISOString().split('T')[0], String(row.balance)]);
        const artifact = await createArtifact({
            tenantId,
            sessionId,
            kind: 'CSV',
            title: 'Overdue Vendors',
            fileName: 'overdue-vendors.csv',
            mimeType: 'text/csv',
            data: buildCsv(columns, dataRows),
            preview: { columns, rows: dataRows },
        });

        return {
            text: 'I prepared a live CSV preview of overdue vendor balances from posted AP bills.',
            block: { type: 'csv_preview', title: 'Overdue Vendor Balances', columns, rows: dataRows.slice(0, 12), artifactId: artifact._id.toString(), fileName: artifact.fileName } as ChatBlock,
        };
    }

    if (previewKey === 'recent_activity') {
        const overview = await getDashboardOverview(tenantId);
        const columns = ['Type', 'Title', 'Status', 'Subtitle', 'Occurred At'];
        const dataRows = overview.recentActivity.map((row: any) => [row.type, row.title, row.status, row.subtitle, row.occurredAt]);
        const artifact = await createArtifact({
            tenantId,
            sessionId,
            kind: 'CSV',
            title: 'Recent Activity',
            fileName: 'dashboard-recent-activity.csv',
            mimeType: 'text/csv',
            data: buildCsv(columns, dataRows),
            preview: { columns, rows: dataRows },
        });

        return {
            text: 'I prepared a CSV preview of the latest operational and finance activity from the dashboard.',
            block: { type: 'csv_preview', title: 'Recent Activity Export', columns, rows: dataRows.slice(0, 12), artifactId: artifact._id.toString(), fileName: artifact.fileName } as ChatBlock,
        };
    }

    const rows = await ARInvoice.find({ tenantId, isDeleted: false, status: 'POSTED', balance: { $gt: 0 }, dueDate: { $lt: today } })
        .sort({ dueDate: 1 })
        .limit(20)
        .select('invoiceNo customerName dueDate balance')
        .lean();

    const columns = ['Invoice No', 'Customer', 'Due Date', 'Balance'];
    const dataRows = rows.map((row: any) => [row.invoiceNo, row.customerName, new Date(row.dueDate).toISOString().split('T')[0], String(row.balance)]);
    const artifact = await createArtifact({
        tenantId,
        sessionId,
        kind: 'CSV',
        title: 'Overdue Customers',
        fileName: 'overdue-customers.csv',
        mimeType: 'text/csv',
        data: buildCsv(columns, dataRows),
        preview: { columns, rows: dataRows },
    });

    return {
        text: 'I prepared a live CSV preview of overdue customer balances from posted AR invoices.',
        block: { type: 'csv_preview', title: 'Overdue Customer Balances', columns, rows: dataRows.slice(0, 12), artifactId: artifact._id.toString(), fileName: artifact.fileName } as ChatBlock,
    };
}

async function buildPdfPreview(tenantId: string, sessionId: string) {
    const overview = await getDashboardOverview(tenantId);
    const lines = [
        `Open payables: ${overview.kpis.openPayables}`,
        `Overdue payables: ${overview.kpis.overduePayables}`,
        `Approved POs awaiting billing: ${overview.operations.approvedPOAwaitingBillingCount}`,
        `Approved POs awaiting receipt: ${overview.operations.approvedPOAwaitingReceiptCount}`,
        '',
        'Attention queue:',
        ...overview.attention.slice(0, 6).map((item: any, index: number) => `${index + 1}. ${item.title} - ${item.detail}`),
    ];
    const artifact = await createArtifact({
        tenantId,
        sessionId,
        kind: 'PDF',
        title: 'Payables Risk Summary',
        fileName: 'payables-risk-summary.pdf',
        mimeType: 'application/pdf',
        data: buildSimplePdf('Payables Risk Summary', lines),
    });

    return {
        text: 'I generated a live PDF summary of current payables risk using the latest dashboard figures and attention items.',
        block: { type: 'pdf_preview', title: 'Payables Risk Summary', summary: 'A one-page live summary of open and overdue payables plus the main payables-related attention items.', artifactId: artifact._id.toString(), fileName: artifact.fileName } as ChatBlock,
    };
}

async function answerCapabilityQuestion(
    tenantId: string,
    moduleKey: CopilotModuleKey,
    message: string,
    conversationContext: string,
) {
    const filters = extractCopilotModuleFilters(moduleKey, message);
    const summary = await getCopilotModuleSummary(tenantId, moduleKey, filters);
    const defaultText = [
        `Overview`,
        summary.summary,
        ``,
        `Highlights`,
        ...summary.facts.map((fact) => `- ${fact}`),
        ``,
        `Next`,
        `1. Ask me to draw a chart for this module.`,
        `2. Ask for an Excel or CSV export.`,
        `3. Open the module if you want the full page.`,
    ].join('\n');
    const text = await composeDashboardAssistantText({
        userMessage: message,
        conversationContext,
        factualContext: compactFacts({
            module: summary.title,
            summary: summary.summary,
            facts: summary.facts,
            latestRows: summary.rows.slice(0, 4),
        }),
        defaultText,
    });

    return {
        text,
        table: summary.rows.length
            ? {
                type: 'table_preview',
                title: `${summary.title} Snapshot`,
                columns: summary.columns,
                rows: summary.rows.slice(0, 8),
            } as ChatBlock
            : null,
    };
}

async function buildFilteredModuleCsvPreview(tenantId: string, sessionId: string, moduleKey: CopilotModuleKey, message: string) {
    const filters = extractCopilotModuleFilters(moduleKey, message);
    const summary = await getCopilotModuleSummary(tenantId, moduleKey, filters);
    const fileName = `${moduleKey.toLowerCase()}.csv`;
    const artifact = await createArtifact({
        tenantId,
        sessionId,
        kind: 'CSV',
        title: `${summary.title} Export`,
        fileName,
        mimeType: 'text/csv',
        data: buildCsv(summary.columns, summary.rows),
        preview: { columns: summary.columns, rows: summary.rows },
    });

    return {
        text: `I prepared a live spreadsheet-style export for ${summary.title.toLowerCase()}.`,
        block: {
            type: 'csv_preview',
            title: `${summary.title} Export`,
            columns: summary.columns,
            rows: summary.rows.slice(0, 12),
            artifactId: artifact._id.toString(),
            fileName,
        } as ChatBlock,
    };
}

async function buildModuleCsvPreview(tenantId: string, sessionId: string, moduleKey: CopilotModuleKey) {
    const summary = await getCopilotModuleSummary(tenantId, moduleKey);
    const fileName = `${moduleKey.toLowerCase()}.csv`;
    const artifact = await createArtifact({
        tenantId,
        sessionId,
        kind: 'CSV',
        title: `${summary.title} Export`,
        fileName,
        mimeType: 'text/csv',
        data: buildCsv(summary.columns, summary.rows),
        preview: { columns: summary.columns, rows: summary.rows },
    });

    return {
        text: `I prepared a live spreadsheet-style export for ${summary.title.toLowerCase()}.`,
        block: {
            type: 'csv_preview',
            title: `${summary.title} Export`,
            columns: summary.columns,
            rows: summary.rows.slice(0, 12),
            artifactId: artifact._id.toString(),
            fileName,
        } as ChatBlock,
    };
}

async function buildModulePdfPreview(tenantId: string, sessionId: string, moduleKey: CopilotModuleKey, message?: string) {
    const filters = message ? extractCopilotModuleFilters(moduleKey, message) : undefined;
    const summary = await getCopilotModuleSummary(tenantId, moduleKey, filters);
    const artifact = await createArtifact({
        tenantId,
        sessionId,
        kind: 'PDF',
        title: `${summary.title} Summary`,
        fileName: `${moduleKey.toLowerCase()}-summary.pdf`,
        mimeType: 'application/pdf',
        data: buildSimplePdf(`${summary.title} Summary`, await buildCopilotModulePdfLines(tenantId, moduleKey, filters)),
    });

    return {
        text: `I generated a PDF summary for ${summary.title.toLowerCase()} from live ERP data.`,
        block: {
            type: 'pdf_preview',
            title: `${summary.title} Summary`,
            summary: summary.summary,
            artifactId: artifact._id.toString(),
            fileName: artifact.fileName,
        } as ChatBlock,
    };
}

async function buildModuleChartPreview(tenantId: string, moduleKey: CopilotModuleKey, message?: string) {
    const filters = message ? extractCopilotModuleFilters(moduleKey, message) : undefined;
    const normalized = safeLower(message || '');

    if (moduleKey === 'CHART_ACCOUNTS' && /(tree|hierarchy|structure)/.test(normalized)) {
        const tree = await chartOfAccountService.getAccountTree(tenantId);
        const rows: string[][] = [];

        const visit = (nodes: any[], depth = 0) => {
            for (const node of nodes || []) {
                rows.push([
                    `${'  '.repeat(depth)}${node.code}`,
                    node.name,
                    node.type,
                    node.isPosting ? 'Posting' : 'Header',
                    node.isActive ? 'Active' : 'Inactive',
                ]);
                if (Array.isArray(node.children) && node.children.length) {
                    visit(node.children, depth + 1);
                }
            }
        };

        visit(tree);

        return {
            text: 'I prepared the real Chart of Accounts hierarchy from your live ERP data.',
            block: {
                type: 'table_preview',
                title: 'Chart of Accounts Tree',
                columns: ['Code', 'Name', 'Type', 'Kind', 'Status'],
                rows: rows.slice(0, 40),
            } as ChatBlock,
            extraBlock: null as ChatBlock | null,
        };
    }

    const chart = await getCopilotModuleChart(tenantId, moduleKey, filters);
    const extraBlock = moduleKey === 'CHART_ACCOUNTS'
        ? {
            type: 'table_preview',
            title: 'Chart of Accounts Snapshot',
            columns: ['Code', 'Name', 'Type', 'Posting', 'Active'],
            rows: (await getCopilotModuleSummary(tenantId, moduleKey, filters)).rows.slice(0, 12),
        } as ChatBlock
        : null;
    return {
        text: `I drew a live chart for ${copilotModuleRegistryTitle(moduleKey)} using current tenant data.`,
        block: {
            type: 'chart',
            title: chart.title,
            subtitle: chart.subtitle,
            chartKind: chart.chartKind,
            data: chart.data,
            series: chart.series,
        } as ChatBlock,
        extraBlock,
    };
}

function copilotModuleRegistryTitle(moduleKey: CopilotModuleKey) {
    return moduleKey
        .toLowerCase()
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

async function buildSystemOverviewAnswer(params: {
    tenantId: string;
    userMessage: string;
    conversationContext: string;
    overview: Awaited<ReturnType<typeof getDashboardOverview>>;
}) {
    const modules = [
        'Chart of Accounts and Journal Entries',
        'Fiscal Calendar',
        'Business Partners',
        'Products, Categories, and UOMs',
        'RFQs and Purchase Orders',
        'Goods Receipts',
        'Vendor Bills and Vendor Payments',
        'Customer Invoices and Customer Receipts',
        'General Ledger, Aging, and Statements',
        'Settings and branded documents',
    ];

    const capabilities = [
        'guide users through ERP workflows',
        'answer live questions about records and balances',
        'prepare charts from supported modules',
        'prepare CSV-style exports',
        'prepare PDF summaries',
        'help create operational and finance records through chat forms',
    ];

    const defaultText = [
        'Overview',
        'ERP KASSIM covers accounting, procurement, inventory, receivables, payables, fiscal setup, and reporting.',
        '',
        'Main modules',
        ...modules.map((module) => `- ${module}`),
        '',
        'What I can do',
        ...capabilities.map((capability, index) => `${index + 1}. ${capability}`),
        '',
        'Next',
        'Tell me which area you want help with, and I can guide the workflow, show records, export data, or open the right page.',
    ].join('\n');

    return composeDashboardAssistantText({
        userMessage: params.userMessage,
        conversationContext: params.conversationContext,
        factualContext: compactFacts({
            modules,
            capabilities,
            company: params.overview.company,
            kpis: params.overview.kpis,
        }),
        defaultText,
    });
}

async function prepareRfqFromMessage(tenantId: string, message: string, existing?: PendingAction | null) {
    const options = await loadFormOptions(tenantId, ['vendors', 'products', 'uoms']);
    const matchedVendor = bestEntityMatch(message, options.vendors);
    const matchedProduct = bestEntityMatch(message, options.products);
    const matchedUom = matchedProduct ? options.uoms.find((uom: any) => uom.id === matchedProduct.uomId) : options.uoms[0];
    const quantity = inferQuantity(message) || 1;
    const baseValues = existing?.formType === 'CREATE_RFQ'
        ? existing.values
        : {
            title: matchedProduct ? `RFQ for ${matchedProduct.name}` : '',
            vendorIds: matchedVendor ? [matchedVendor.id] : [],
            items: [
                {
                    lineType: matchedProduct ? 'CATALOG' : 'MANUAL',
                    productId: matchedProduct?.id || '',
                    description: matchedProduct?.name || '',
                    quantity,
                    uomId: matchedUom?.id || '',
                },
            ],
        };

    if (existing?.formType === 'CREATE_RFQ') {
        if (matchedVendor && !baseValues.vendorIds.includes(matchedVendor.id)) {
            baseValues.vendorIds = [...baseValues.vendorIds, matchedVendor.id];
        }
        if (matchedProduct && baseValues.items?.[0]) {
            baseValues.items[0] = {
                ...baseValues.items[0],
                lineType: 'CATALOG',
                productId: matchedProduct.id,
                description: matchedProduct.name,
                quantity: quantity || baseValues.items[0].quantity,
                uomId: matchedUom?.id || baseValues.items[0].uomId,
            };
        }
    }

    const missingFields = getRfqMissingFields(baseValues);
    return {
        pendingAction: { formType: 'CREATE_RFQ' as const, values: baseValues, options, executionModes: getExecutionChoices('CREATE_RFQ'), defaultExecutionMode: 'SAVE' as AssistantExecutionMode },
        blocks: [buildRfqFormPayload(baseValues, options, missingFields)],
        missingFields,
    };
}

async function prepareArInvoiceFromMessage(tenantId: string, message: string, existing?: PendingAction | null) {
    const options = await loadFormOptions(tenantId, ['customers', 'products', 'postingAccounts', 'defaults']);
    const matchedCustomer = bestEntityMatch(message, options.customers);
    const matchedProduct = bestEntityMatch(message, options.products);
    const matchedRevenue = bestEntityMatch(message, options.revenueAccounts);
    const matchedAr = bestEntityMatch(message, options.arAccounts);
    const quantity = inferQuantity(message) || 1;
    const unitPrice = inferUnitPrice(message) || matchedProduct?.unitPrice || 0;
    const today = new Date().toISOString().split('T')[0];
    const dueDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString().split('T')[0];

    const baseValues = existing?.formType === 'CREATE_AR_INVOICE'
        ? existing.values
        : {
            customerId: matchedCustomer?.id || '',
            invoiceDate: today,
            postingDate: today,
            dueDate,
            currency: options.defaults.currency,
            notes: '',
            items: [
                {
                    lineType: matchedProduct ? 'CATALOG' : 'MANUAL',
                    productId: matchedProduct?.id || '',
                    itemKind: matchedProduct?.type || 'MANUAL',
                    description: matchedProduct?.name || '',
                    quantity,
                    unitPrice,
                },
            ],
            accounting: {
                revenueAccountId: matchedRevenue?.id || '',
                arAccountId: matchedAr?.id || options.defaults.accountsReceivable || '',
            },
        };

    if (existing?.formType === 'CREATE_AR_INVOICE') {
        if (matchedCustomer) baseValues.customerId = matchedCustomer.id;
        if (matchedProduct && baseValues.items?.[0]) {
            baseValues.items[0] = {
                ...baseValues.items[0],
                lineType: 'CATALOG',
                productId: matchedProduct.id,
                itemKind: matchedProduct.type,
                description: matchedProduct.name,
                quantity: quantity || baseValues.items[0].quantity,
                unitPrice: unitPrice || baseValues.items[0].unitPrice,
            };
        }
        if (matchedRevenue) baseValues.accounting.revenueAccountId = matchedRevenue.id;
        if (matchedAr) baseValues.accounting.arAccountId = matchedAr.id;
    }

    const missingFields = getArInvoiceMissingFields(baseValues);
    return {
        pendingAction: { formType: 'CREATE_AR_INVOICE' as const, values: baseValues, options, executionModes: getExecutionChoices('CREATE_AR_INVOICE'), defaultExecutionMode: 'SAVE' as AssistantExecutionMode },
        blocks: [buildArInvoiceFormPayload(baseValues, options, missingFields)],
        missingFields,
    };
}

async function preparePurchaseOrderFromMessage(tenantId: string, message: string, existing?: PendingAction | null) {
    const options = await loadFormOptions(tenantId, ['vendors', 'products', 'uoms', 'defaults']);
    const matchedVendor = bestEntityMatch(message, options.vendors);
    const matchedProduct = bestEntityMatch(message, options.products);
    const matchedUom = matchedProduct ? options.uoms.find((uom: any) => uom.id === matchedProduct.uomId) : options.uoms[0];
    const quantity = inferQuantity(message) || 1;
    const unitPrice = inferUnitPrice(message) || matchedProduct?.unitPrice || 0;
    const today = new Date().toISOString().split('T')[0];

    const baseValues = existing?.formType === 'CREATE_PURCHASE_ORDER'
        ? existing.values
        : {
            vendorId: matchedVendor?.id || '',
            orderDate: today,
            expectedDeliveryDate: '',
            currency: options.defaults.currency,
            notes: '',
            lines: [
                {
                    productId: matchedProduct?.id || '',
                    uomId: matchedUom?.id || '',
                    description: matchedProduct?.name || '',
                    quantity,
                    unitPrice,
                    vatRate: options.defaults.vatRate || 0,
                },
            ],
        };

    if (matchedVendor) baseValues.vendorId = matchedVendor.id;
    if (matchedProduct && baseValues.lines?.[0]) {
        baseValues.lines[0] = {
            ...baseValues.lines[0],
            productId: matchedProduct.id,
            uomId: matchedUom?.id || baseValues.lines[0].uomId,
            description: matchedProduct.name,
            quantity: quantity || baseValues.lines[0].quantity,
            unitPrice: unitPrice || baseValues.lines[0].unitPrice,
        };
    }

    const missingFields = getPurchaseOrderMissingFields(baseValues);
    return {
        pendingAction: { formType: 'CREATE_PURCHASE_ORDER' as const, values: baseValues, options, executionModes: getExecutionChoices('CREATE_PURCHASE_ORDER'), defaultExecutionMode: 'SAVE' as AssistantExecutionMode },
        blocks: [buildPurchaseOrderFormPayload(baseValues, options, missingFields)],
        missingFields,
    };
}

async function prepareGrnFromMessage(tenantId: string, message: string, existing?: PendingAction | null) {
    const options = await loadFormOptions(tenantId, ['receivablePurchaseOrders']);
    const matchedPo = bestEntityMatch(message, options.receivablePurchaseOrders.map((po: any) => ({ id: po.id, name: po.label, code: po.poNumber })));
    const selectedPo = options.receivablePurchaseOrders.find((po: any) => po.id === matchedPo?.id) || options.receivablePurchaseOrders[0];
    const today = new Date().toISOString().split('T')[0];
    const existingLines = existing?.formType === 'CREATE_GRN' ? existing.values.lines : null;

    const baseValues = existing?.formType === 'CREATE_GRN'
        ? existing.values
        : {
            poId: selectedPo?.id || '',
            receiptDate: today,
            notes: '',
            lines: (selectedPo?.lines || []).map((line: any) => ({
                poLineIndex: line.poLineIndex,
                productId: line.productId || '',
                description: line.description,
                receivedQty: line.orderedQty,
                unitCost: line.unitCost,
                lineTotal: line.lineTotal,
            })),
        };

    if (selectedPo && (!baseValues.poId || baseValues.poId !== selectedPo.id || !existingLines)) {
        baseValues.poId = selectedPo.id;
        baseValues.lines = (selectedPo.lines || []).map((line: any) => ({
            poLineIndex: line.poLineIndex,
            productId: line.productId || '',
            description: line.description,
            receivedQty: line.orderedQty,
            unitCost: line.unitCost,
            lineTotal: line.lineTotal,
        }));
    }

    const missingFields = getGrnMissingFields(baseValues);
    return {
        pendingAction: { formType: 'CREATE_GRN' as const, values: baseValues, options, executionModes: getExecutionChoices('CREATE_GRN'), defaultExecutionMode: 'SAVE' as AssistantExecutionMode },
        blocks: [buildGrnFormPayload(baseValues, options, missingFields)],
        missingFields,
    };
}

async function prepareApInvoiceFromMessage(tenantId: string, message: string, existing?: PendingAction | null) {
    const options = await loadFormOptions(tenantId, ['vendors', 'approvedPurchaseOrders', 'postingAccounts', 'defaults']);
    const matchedVendor = bestEntityMatch(message, options.vendors);
    const matchedPo = bestEntityMatch(message, options.approvedPurchaseOrders.map((po: any) => ({ id: po.id, name: po.label, code: po.poNumber })));
    const selectedPo = options.approvedPurchaseOrders.find((po: any) => po.id === matchedPo?.id);
    const today = new Date().toISOString().split('T')[0];
    const matchedExpense = bestEntityMatch(message, options.expenseAccounts);
    const matchedAp = bestEntityMatch(message, options.apAccounts);

    const baseValues = existing?.formType === 'CREATE_AP_INVOICE'
        ? existing.values
        : {
            vendorId: selectedPo?.vendorId || matchedVendor?.id || '',
            invoiceDate: today,
            postingDate: today,
            dueDate: today,
            currencyCode: selectedPo?.currency || options.defaults.currency,
            notes: '',
            source: selectedPo ? { purchaseOrderId: selectedPo.id, poNo: selectedPo.poNumber } : undefined,
            items: selectedPo
                ? selectedPo.lines.map((line: any) => ({
                    description: line.description,
                    quantity: line.quantity,
                    unitPrice: line.unitPrice,
                }))
                : [{ description: '', quantity: 1, unitPrice: 0 }],
            accounting: {
                expenseAccountId: matchedExpense?.id || '',
                apAccountId: matchedAp?.id || options.defaults.accountsPayable || '',
            },
        };

    if (matchedVendor) baseValues.vendorId = matchedVendor.id;
    if (selectedPo) {
        baseValues.vendorId = selectedPo.vendorId;
        baseValues.currencyCode = selectedPo.currency || baseValues.currencyCode;
        baseValues.source = { purchaseOrderId: selectedPo.id, poNo: selectedPo.poNumber };
        baseValues.items = selectedPo.lines.map((line: any) => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
        }));
    }
    if (matchedExpense) baseValues.accounting.expenseAccountId = matchedExpense.id;
    if (matchedAp) baseValues.accounting.apAccountId = matchedAp.id;

    const missingFields = getApInvoiceMissingFields(baseValues);
    return {
        pendingAction: { formType: 'CREATE_AP_INVOICE' as const, values: baseValues, options, executionModes: getExecutionChoices('CREATE_AP_INVOICE'), defaultExecutionMode: 'SAVE' as AssistantExecutionMode },
        blocks: [buildApInvoiceFormPayload(baseValues, options, missingFields)],
        missingFields,
    };
}

async function prepareArReceiptFromMessage(tenantId: string, message: string, existing?: PendingAction | null) {
    const options = await loadFormOptions(tenantId, ['customers', 'postingAccounts', 'defaults', 'outstandingArInvoices']);
    const matchedCustomer = bestEntityMatch(message, options.customers);
    const customerId = matchedCustomer?.id || existing?.values?.customerId || '';
    const outstanding = options.outstandingArInvoices.filter((invoice: any) => !customerId || invoice.customerId === customerId);
    const totalOutstanding = outstanding.reduce((sum: number, invoice: any) => sum + Number(invoice.outstanding || 0), 0);
    const today = new Date().toISOString().split('T')[0];

    const baseValues = existing?.formType === 'CREATE_AR_RECEIPT'
        ? existing.values
        : {
            customerId,
            receiptDate: today,
            postingDate: today,
            method: 'BANK',
            bankAccountId: options.defaults.bankAccount || options.defaults.cashAccount || '',
            arAccountId: options.defaults.accountsReceivable || '',
            amount: totalOutstanding || 0,
            memo: '',
            allocations: outstanding.map((invoice: any) => ({
                invoiceId: invoice.id,
                invoiceNo: invoice.invoiceNo,
                allocatedAmount: invoice.outstanding,
            })),
        };

    if (matchedCustomer) {
        baseValues.customerId = matchedCustomer.id;
        baseValues.allocations = outstanding.map((invoice: any) => ({
            invoiceId: invoice.id,
            invoiceNo: invoice.invoiceNo,
            allocatedAmount: invoice.outstanding,
        }));
        baseValues.amount = totalOutstanding || baseValues.amount;
    }

    const missingFields = getArReceiptMissingFields(baseValues);
    return {
        pendingAction: { formType: 'CREATE_AR_RECEIPT' as const, values: baseValues, options, executionModes: getExecutionChoices('CREATE_AR_RECEIPT'), defaultExecutionMode: 'SAVE' as AssistantExecutionMode },
        blocks: [buildArReceiptFormPayload(baseValues, options, missingFields)],
        missingFields,
    };
}

async function prepareApPaymentFromMessage(tenantId: string, message: string, existing?: PendingAction | null) {
    const options = await loadFormOptions(tenantId, ['vendors', 'postingAccounts', 'defaults', 'outstandingApInvoices']);
    const matchedVendor = bestEntityMatch(message, options.vendors);
    const vendorId = matchedVendor?.id || existing?.values?.vendorId || '';
    const outstanding = options.outstandingApInvoices.filter((invoice: any) => !vendorId || invoice.vendorId === vendorId);
    const totalOutstanding = outstanding.reduce((sum: number, invoice: any) => sum + Number(invoice.outstanding || 0), 0);
    const today = new Date().toISOString().split('T')[0];

    const baseValues = existing?.formType === 'CREATE_AP_PAYMENT'
        ? existing.values
        : {
            vendorId,
            paymentDate: today,
            postingDate: today,
            method: 'BANK',
            paymentAccountId: options.defaults.bankAccount || options.defaults.cashAccount || '',
            apAccountId: options.defaults.accountsPayable || '',
            amount: totalOutstanding || 0,
            memo: '',
            allocations: outstanding.map((invoice: any) => ({
                invoiceId: invoice.id,
                invoiceNo: invoice.invoiceNo,
                allocatedAmount: invoice.outstanding,
            })),
        };

    if (matchedVendor) {
        baseValues.vendorId = matchedVendor.id;
        baseValues.allocations = outstanding.map((invoice: any) => ({
            invoiceId: invoice.id,
            invoiceNo: invoice.invoiceNo,
            allocatedAmount: invoice.outstanding,
        }));
        baseValues.amount = totalOutstanding || baseValues.amount;
    }

    const missingFields = getApPaymentMissingFields(baseValues);
    return {
        pendingAction: { formType: 'CREATE_AP_PAYMENT' as const, values: baseValues, options, executionModes: getExecutionChoices('CREATE_AP_PAYMENT'), defaultExecutionMode: 'SAVE' as AssistantExecutionMode },
        blocks: [buildApPaymentFormPayload(baseValues, options, missingFields)],
        missingFields,
    };
}

async function prepareChartAccountFromMessage(tenantId: string, message: string, existing?: PendingAction | null) {
    const options = await loadFormOptions(tenantId, ['headerAccounts']);
    const matchedParent = bestEntityMatch(message, options.headerAccounts);
    const inferredType = inferAccountType(message);
    const inferredCode = inferAccountCode(message);
    const inferredName = inferFreeTextName(message, '');
    const normalized = safeLower(message);

    const baseValues = existing?.formType === 'CREATE_CHART_ACCOUNT'
        ? existing.values
        : {
            code: inferredCode || '',
            name: inferredName,
            type: inferredType || '',
            parentId: matchedParent?.id || '',
            isPosting: !/(header|folder|group)/.test(normalized),
            description: '',
        };

    if (existing?.formType === 'CREATE_CHART_ACCOUNT') {
        if (inferredCode) baseValues.code = inferredCode;
        if (inferredName) baseValues.name = inferredName;
        if (inferredType) baseValues.type = inferredType;
        if (matchedParent) baseValues.parentId = matchedParent.id;
        if (/(header|folder|group)/.test(normalized)) baseValues.isPosting = false;
    }

    const missingFields = getChartAccountMissingFields(baseValues);
    return {
        pendingAction: { formType: 'CREATE_CHART_ACCOUNT' as const, values: baseValues, options, executionModes: getExecutionChoices('CREATE_CHART_ACCOUNT'), defaultExecutionMode: 'SAVE' as AssistantExecutionMode },
        blocks: [buildChartAccountFormPayload(baseValues, options, missingFields)],
        missingFields,
    };
}

async function prepareFiscalYearFromMessage(tenantId: string, message: string, existing?: PendingAction | null) {
    void tenantId;
    const inferred = inferFiscalYearWindow(message);
    const baseValues = existing?.formType === 'CREATE_FISCAL_YEAR'
        ? existing.values
        : {
            yearName: inferred.yearName,
            startDate: inferred.startDate,
            endDate: inferred.endDate,
            isActive: true,
            generatePeriods: true,
        };

    if (existing?.formType === 'CREATE_FISCAL_YEAR') {
        baseValues.yearName = inferred.yearName || baseValues.yearName;
        baseValues.startDate = inferred.startDate || baseValues.startDate;
        baseValues.endDate = inferred.endDate || baseValues.endDate;
    }

    const missingFields = getFiscalYearMissingFields(baseValues);
    return {
        pendingAction: { formType: 'CREATE_FISCAL_YEAR' as const, values: baseValues, options: {}, executionModes: getExecutionChoices('CREATE_FISCAL_YEAR'), defaultExecutionMode: 'SAVE' as AssistantExecutionMode },
        blocks: [buildFiscalYearFormPayload(baseValues, missingFields)],
        missingFields,
    };
}

async function prepareBusinessPartnerFromMessage(tenantId: string, message: string, existing?: PendingAction | null) {
    const options = await loadFormOptions(tenantId, ['defaults']);
    const normalized = safeLower(message);
    const inferredName = inferFreeTextName(message, '');
    const roles = [
        normalized.includes('customer') ? 'CUSTOMER' : null,
        normalized.includes('vendor') || normalized.includes('supplier') ? 'VENDOR' : null,
    ].filter(Boolean);

    const baseValues = existing?.formType === 'CREATE_BUSINESS_PARTNER'
        ? existing.values
        : {
            name: inferredName,
            roles,
            currency: options.defaults.currency,
            status: 'ACTIVE',
            taxNumber: '',
            email: '',
            phone: '',
            paymentTerms: options.defaults.paymentTermsOptions?.[0] || '',
            creditLimit: undefined,
            address: { country: '', city: '', street: '', postalCode: '' },
        };

    if (existing?.formType === 'CREATE_BUSINESS_PARTNER') {
        if (inferredName) baseValues.name = inferredName;
        if (roles.length > 0) baseValues.roles = Array.from(new Set([...(baseValues.roles || []), ...roles]));
    }

    const missingFields = getBusinessPartnerMissingFields(baseValues);
    return {
        pendingAction: { formType: 'CREATE_BUSINESS_PARTNER' as const, values: baseValues, options, executionModes: getExecutionChoices('CREATE_BUSINESS_PARTNER'), defaultExecutionMode: 'SAVE' as AssistantExecutionMode },
        blocks: [buildBusinessPartnerFormPayload(baseValues, options, missingFields)],
        missingFields,
    };
}

async function prepareCategoryFromMessage(tenantId: string, message: string, existing?: PendingAction | null) {
    void tenantId;
    const inferredName = inferFreeTextName(message, '');
    const baseValues = existing?.formType === 'CREATE_CATEGORY'
        ? existing.values
        : {
            name: inferredName,
            status: 'ACTIVE',
        };

    if (existing?.formType === 'CREATE_CATEGORY' && inferredName) {
        baseValues.name = inferredName;
    }

    const missingFields = getCategoryMissingFields(baseValues);
    return {
        pendingAction: { formType: 'CREATE_CATEGORY' as const, values: baseValues, options: {}, executionModes: getExecutionChoices('CREATE_CATEGORY'), defaultExecutionMode: 'SAVE' as AssistantExecutionMode },
        blocks: [buildCategoryFormPayload(baseValues, missingFields)],
        missingFields,
    };
}

async function prepareUomFromMessage(tenantId: string, message: string, existing?: PendingAction | null) {
    void tenantId;
    const inferredName = inferFreeTextName(message, '');
    const symbolMatch = message.match(/\b[A-Z]{1,5}\b/);
    const inferredSymbol = symbolMatch?.[0] || '';
    const baseValues = existing?.formType === 'CREATE_UOM'
        ? existing.values
        : {
            name: inferredName,
            symbol: inferredSymbol,
            status: 'ACTIVE',
        };

    if (existing?.formType === 'CREATE_UOM') {
        if (inferredName) baseValues.name = inferredName;
        if (inferredSymbol) baseValues.symbol = inferredSymbol;
    }

    const missingFields = getUomMissingFields(baseValues);
    return {
        pendingAction: { formType: 'CREATE_UOM' as const, values: baseValues, options: {}, executionModes: getExecutionChoices('CREATE_UOM'), defaultExecutionMode: 'SAVE' as AssistantExecutionMode },
        blocks: [buildUomFormPayload(baseValues, missingFields)],
        missingFields,
    };
}

async function prepareProductFromMessage(tenantId: string, message: string, existing?: PendingAction | null) {
    const options = await loadFormOptions(tenantId, ['categories', 'uoms']);
    const normalized = safeLower(message);
    const matchedCategory = bestEntityMatch(message, options.categories);
    const matchedUom = bestEntityMatch(message, options.uoms);
    const inferredName = inferFreeTextName(message, '');
    const type = normalized.includes('service') ? 'SERVICE' : 'PRODUCT';

    const baseValues = existing?.formType === 'CREATE_PRODUCT'
        ? existing.values
        : {
            name: inferredName,
            type,
            categoryId: matchedCategory?.id || '',
            uomId: matchedUom?.id || '',
            unitPrice: inferUnitPrice(message) || 0,
            costPrice: type === 'PRODUCT' ? inferUnitPrice(message) || 0 : undefined,
            vatRate: 5,
            inventoryTracked: type === 'PRODUCT',
            status: 'ACTIVE',
        };

    if (existing?.formType === 'CREATE_PRODUCT') {
        if (inferredName) baseValues.name = inferredName;
        baseValues.type = type || baseValues.type;
        if (matchedCategory) baseValues.categoryId = matchedCategory.id;
        if (matchedUom) baseValues.uomId = matchedUom.id;
        const inferredPrice = inferUnitPrice(message);
        if (inferredPrice !== undefined) {
            baseValues.unitPrice = inferredPrice;
            if (baseValues.type === 'PRODUCT') baseValues.costPrice = inferredPrice;
        }
        baseValues.inventoryTracked = baseValues.type === 'PRODUCT';
    }

    const missingFields = getProductMissingFields(baseValues);
    return {
        pendingAction: { formType: 'CREATE_PRODUCT' as const, values: baseValues, options, executionModes: getExecutionChoices('CREATE_PRODUCT'), defaultExecutionMode: 'SAVE' as AssistantExecutionMode },
        blocks: [buildProductFormPayload(baseValues, options, missingFields)],
        missingFields,
    };
}

function activatePreparedWorkflow(params: {
    session: any;
    stack: WorkflowNode[];
    activeWorkflowId?: string | null;
    prepared: { pendingAction: PendingAction; missingFields: string[] };
    formType: AssistantFormType;
}) {
    const currentActive = getActiveWorkflowNode(params.stack, params.activeWorkflowId);
    const blocks: ChatBlock[] = [];
    let activeWorkflowId = params.activeWorkflowId || null;

    if (currentActive && currentActive.formType !== params.formType) {
        currentActive.status = 'paused';
        currentActive.summary = `${assistantModuleRegistry[currentActive.formType].title} is paused while another task is active.`;
        upsertWorkflowNode(params.stack, currentActive);
    }

    const parentWorkflowId = currentActive && currentActive.formType !== params.formType && shouldNestDependency(currentActive.formType, params.formType)
        ? currentActive.id
        : null;

    if (parentWorkflowId) {
        blocks.push({
            type: 'dependency_prompt',
            workflowId: parentWorkflowId,
            formType: params.formType,
            summary: `${assistantModuleRegistry[params.formType].title} is required before the blocked parent task can continue. I opened it first and will return automatically when it is done.`,
        });
    }

    const existingIndex = params.stack.findIndex((workflow) => workflow.id === activeWorkflowId && workflow.formType === params.formType);
    const nextWorkflow = createWorkflowNode({
        pendingAction: params.prepared.pendingAction,
        missingFields: params.prepared.missingFields,
        parentWorkflowId,
        id: existingIndex >= 0 ? params.stack[existingIndex].id : undefined,
        executionMode: params.prepared.pendingAction.defaultExecutionMode,
    });
    upsertWorkflowNode(params.stack, nextWorkflow);
    activeWorkflowId = nextWorkflow.id;
    syncSessionWorkflowState(params.session, params.stack, activeWorkflowId);

    return { blocks, activeWorkflowId, activeWorkflow: nextWorkflow };
}

async function persistAssistantTurn(
    session: any,
    blocks: ChatBlock[],
    nextPendingAction?: PendingAction | null,
    lastIntent?: string,
    workflowState?: WorkflowState | null,
    previousFormStatus?: 'paused' | 'superseded' | 'completed',
) {
    if (previousFormStatus) {
        markLatestFormRequestStatus(session, previousFormStatus);
    } else if (blocks.some((block) => block.type === 'form_request' && (block.status || 'active') === 'active')) {
        markLatestFormRequestStatus(session, 'superseded');
    }

    const assistantTurn = asTurn('assistant', blocks);
    session.turns.push(assistantTurn);
    session.pendingAction = nextPendingAction || null;
    session.conversationSummary = summarizeTurnsForPrompt(session.turns as ChatTurn[]);
    const derivedWorkflow = workflowState ?? deriveWorkflowState(
        nextPendingAction,
        (blocks.find((block) => block.type === 'form_request') as Extract<ChatBlock, { type: 'form_request' }> | undefined)?.missingFields || [],
    );
    session.workflowState = derivedWorkflow;
    session.workingState = derivedWorkflow;
    if (lastIntent) session.lastIntent = lastIntent;
    await session.save();
    return assistantTurn;
}

export async function createOrResumeDashboardChatSession(tenantId: string, userId: string, sessionId?: string) {
    if (sessionId) {
        const existing = await DashboardChatSession.findOne({ _id: sessionId, tenantId, userId });
        if (existing) return mapSession(existing.toObject());
    }

    const session = await DashboardChatSession.create({
        tenantId,
        userId,
        title: 'Dashboard Copilot Session',
        workflowStack: [],
        activeWorkflowId: null,
        turns: [
            asTurn('assistant', [
                {
                    type: 'text',
                    text: 'Hello. I can explain live ERP data, draw charts, prepare CSV or PDF previews, and help create operational and finance records using the same flows your system supports.',
                },
            ]),
        ],
    });

    return mapSession(session.toObject());
}

export async function listDashboardChatSessions(tenantId: string, userId: string) {
    const sessions = await DashboardChatSession.find({ tenantId, userId })
        .sort({ updatedAt: -1 })
        .limit(30)
        .select('title turns createdAt updatedAt')
        .lean();

    return sessions.map((session: any) => mapSessionSummary(session));
}

export async function getDashboardChatSession(tenantId: string, userId: string, sessionId: string) {
    const session = await DashboardChatSession.findOne({ _id: sessionId, tenantId, userId });
    if (!session) throw new ServiceError('Dashboard chat session not found', 'NOT_FOUND');
    return mapSession(session.toObject());
}

export async function sendDashboardChatMessage(tenantId: string, userId: string, dto: DashboardChatMessageDTO) {
    const session = await DashboardChatSession.findOne({ _id: dto.sessionId, tenantId, userId });
    if (!session) throw new ServiceError('Dashboard chat session not found', 'NOT_FOUND');

    session.turns.push(asTurn('user', [{ type: 'text', text: dto.message } as ChatBlock]));
    session.title = deriveSessionTitle(dto.message, session.title);

    const workflowStack = getWorkflowStack(session);
    const activeWorkflowNode = getActiveWorkflowNode(workflowStack, session.activeWorkflowId);
    const currentWorkflowState = deriveWorkflowStateFromNode(activeWorkflowNode);
    const overview = await getDashboardOverview(tenantId);
    const conversationContext = buildConversationContext(session.turns as ChatTurn[], session.conversationSummary || '');
    const classification = await classifyDashboardPrompt(dto.message, getWorkflowSummary(currentWorkflowState), conversationContext);
    const blocks: ChatBlock[] = [];
    let nextPendingAction: PendingAction | null = activeWorkflowNode ? toPendingAction(activeWorkflowNode) : session.pendingAction as PendingAction | null;
    let nextWorkflowState: WorkflowState | null = currentWorkflowState;
    let previousFormStatus: 'paused' | 'superseded' | 'completed' | undefined;

    const activeWorkflow = activeWorkflowNode && currentWorkflowState && ['collecting_form', 'awaiting_execution'].includes(currentWorkflowState.status)
        ? currentWorkflowState
        : null;
    const pausedWorkflow = nextPendingAction && currentWorkflowState?.status === 'paused'
        ? currentWorkflowState
        : null;

    const intentToFormType = (intent: string): AssistantFormType | null => {
        switch (intent) {
            case 'CREATE_RFQ': return 'CREATE_RFQ';
            case 'CREATE_CATEGORY': return 'CREATE_CATEGORY';
            case 'CREATE_UOM': return 'CREATE_UOM';
            case 'CREATE_AR_INVOICE': return 'CREATE_AR_INVOICE';
            case 'CREATE_PURCHASE_ORDER': return 'CREATE_PURCHASE_ORDER';
            case 'CREATE_GRN': return 'CREATE_GRN';
            case 'CREATE_AP_INVOICE': return 'CREATE_AP_INVOICE';
            case 'CREATE_AR_RECEIPT': return 'CREATE_AR_RECEIPT';
            case 'CREATE_AP_PAYMENT': return 'CREATE_AP_PAYMENT';
            case 'CREATE_CHART_ACCOUNT': return 'CREATE_CHART_ACCOUNT';
            case 'CREATE_FISCAL_YEAR': return 'CREATE_FISCAL_YEAR';
            case 'CREATE_BUSINESS_PARTNER': return 'CREATE_BUSINESS_PARTNER';
            case 'CREATE_PRODUCT': return 'CREATE_PRODUCT';
            default: return null;
        }
    };

    const incomingFormType = intentToFormType(classification.intent);
    const shouldContinueWorkflow = Boolean(
        nextPendingAction && (
            classification.intent === 'CONTINUE_WORKFLOW'
            || classification.intent === 'FIELDS_MISSING'
            || (incomingFormType && incomingFormType === nextPendingAction.formType)
        )
    );
    const shouldPauseWorkflow = Boolean(
        activeWorkflow
        && nextPendingAction
        && !shouldContinueWorkflow
        && ['ASK', 'GREETING', 'NAVIGATE', 'DRAW_CHART', 'PREVIEW_CSV', 'PREVIEW_PDF'].includes(classification.intent)
    );
    const continuationPendingAction = shouldContinueWorkflow ? nextPendingAction : null;

    if (classification.intent === 'CANCEL_WORKFLOW' && nextPendingAction) {
        blocks.push({
            type: 'text',
            text: `I cancelled the ${assistantModuleRegistry[nextPendingAction.formType].title.toLowerCase()} workflow. You can start a new task whenever you want.`,
        });
        blocks.push({
            type: 'action_summary',
            title: 'Workflow cancelled',
            detail: `${assistantModuleRegistry[nextPendingAction.formType].title} is no longer active in this chat.`,
        });
        previousFormStatus = 'superseded';
        nextWorkflowState = {
            status: 'cancelled',
            formType: nextPendingAction.formType,
            missingFields: computeMissingFields(nextPendingAction.formType, nextPendingAction.values),
            executionMode: nextPendingAction.defaultExecutionMode,
            summary: `${assistantModuleRegistry[nextPendingAction.formType].title} workflow was cancelled.`,
        };
        nextPendingAction = null;
    } else if (classification.intent === 'RESUME_WORKFLOW' && nextPendingAction) {
        const resumedBlock = buildPendingActionFormBlock(nextPendingAction, 'active') as Extract<ChatBlock, { type: 'form_request' }>;
        blocks.push({
            type: 'text',
            text: `I restored the ${assistantModuleRegistry[nextPendingAction.formType].title.toLowerCase()} workflow so you can continue from where you left off.`,
        });
        blocks.push({
            type: 'workflow_resumed',
            formType: nextPendingAction.formType,
            summary: `${assistantModuleRegistry[nextPendingAction.formType].title} is active again.`,
        });
        blocks.push(resumedBlock);
        previousFormStatus = 'superseded';
        nextWorkflowState = deriveWorkflowState(nextPendingAction, resumedBlock.missingFields);
    } else if (classification.intent === 'GREETING') {
        const defaultText = `Hello. ${overview.ai.summary}`;
        const text = await composeDashboardAssistantText({
            userMessage: dto.message,
            conversationContext,
            factualContext: compactFacts({ ai: overview.ai, kpis: overview.kpis, workflow: currentWorkflowState }),
            defaultText,
        });
        blocks.push({ type: 'text', text });
    } else if (classification.intent === 'ASK_HELP') {
        const text = await buildSystemOverviewAnswer({
            tenantId,
            userMessage: dto.message,
            conversationContext,
            overview,
        });
        blocks.push({ type: 'text', text });
    } else if (classification.intent === 'NAVIGATE' && classification.pageKey) {
        const target = assistantNavigationMap[classification.pageKey];
        blocks.push({
            type: 'text',
            text: `I can take you to ${target.title}.`,
        });
        blocks.push({
            type: 'navigation',
            title: `Open ${target.title}`,
            destination: target.destination,
            summary: `Navigating to ${target.title}.`,
            autoNavigate: true,
        });
    } else if (classification.intent === 'DRAW_CHART') {
        if (classification.moduleKey) {
            const preview = await buildModuleChartPreview(tenantId, classification.moduleKey, dto.message);
            blocks.push({ type: 'text', text: preview.text });
            blocks.push(preview.block);
            if (preview.extraBlock) {
                blocks.push(preview.extraBlock);
            }
        } else {
            blocks.push({
                type: 'text',
                text: await composeDashboardAssistantText({
                    userMessage: dto.message,
                    conversationContext,
                    factualContext: compactFacts({ chart: classification.chartKey, kpis: overview.kpis, operations: overview.operations }),
                    defaultText: 'I drew a live chart from the current ERP data so you can inspect the trend directly.',
                }),
            });
            blocks.push(buildChartBlock(overview, classification.chartKey));
        }
    } else if (classification.intent === 'PREVIEW_CSV') {
        const preview = classification.moduleKey
            ? await buildFilteredModuleCsvPreview(tenantId, dto.sessionId, classification.moduleKey, dto.message)
            : await buildCsvPreview(tenantId, dto.sessionId, classification.previewKey);
        blocks.push({ type: 'text', text: preview.text });
        blocks.push(preview.block);
    } else if (classification.intent === 'PREVIEW_PDF') {
        const preview = classification.moduleKey
            ? await buildModulePdfPreview(tenantId, dto.sessionId, classification.moduleKey, dto.message)
            : await buildPdfPreview(tenantId, dto.sessionId);
        blocks.push({ type: 'text', text: preview.text });
        blocks.push(preview.block);
    } else if (classification.intent === 'ASK' && classification.moduleKey) {
        const answer = await answerCapabilityQuestion(tenantId, classification.moduleKey, dto.message, conversationContext);
        blocks.push({ type: 'text', text: answer.text });
        if (answer.table) {
            blocks.push(answer.table);
        }
        blocks.push({
            type: 'navigation',
            title: `Open ${copilotModuleRegistryTitle(classification.moduleKey)}`,
            destination: getCopilotModuleDestination(classification.moduleKey),
            summary: `Open the ${copilotModuleRegistryTitle(classification.moduleKey)} module.`,
        });
    } else if (classification.intent === 'CREATE_CATEGORY') {
        const prepared = await prepareCategoryFromMessage(tenantId, dto.message, nextPendingAction);
        const activation = activatePreparedWorkflow({
            session,
            stack: workflowStack,
            activeWorkflowId: session.activeWorkflowId,
            prepared,
            formType: 'CREATE_CATEGORY',
        });
        nextPendingAction = session.pendingAction;
        blocks.push(...activation.blocks);
        blocks.push({
            type: 'text',
            text: prepared.missingFields.length > 0
                ? `I opened the category task. I still need: ${prepared.missingFields.join(', ')}.`
                : 'I prepared the category details. Review them, then confirm creation.',
        });
        blocks.push(...prepared.blocks);
    } else if (classification.intent === 'CREATE_UOM') {
        const prepared = await prepareUomFromMessage(tenantId, dto.message, nextPendingAction);
        const activation = activatePreparedWorkflow({
            session,
            stack: workflowStack,
            activeWorkflowId: session.activeWorkflowId,
            prepared,
            formType: 'CREATE_UOM',
        });
        nextPendingAction = session.pendingAction;
        blocks.push(...activation.blocks);
        blocks.push({
            type: 'text',
            text: prepared.missingFields.length > 0
                ? `I opened the UOM task. I still need: ${prepared.missingFields.join(', ')}.`
                : 'I prepared the UOM details. Review them, then confirm creation.',
        });
        blocks.push(...prepared.blocks);
    } else if (classification.intent === 'CREATE_RFQ') {
        const prepared = await prepareRfqFromMessage(tenantId, dto.message, nextPendingAction);
        activatePreparedWorkflow({
            session,
            stack: workflowStack,
            activeWorkflowId: session.activeWorkflowId,
            prepared,
            formType: 'CREATE_RFQ',
        });
        nextPendingAction = session.pendingAction;
        const defaultText = prepared.missingFields.length > 0
            ? `I prepared the RFQ form. I still need: ${prepared.missingFields.join(', ')}.`
            : 'I prepared the RFQ details. Review them and choose the action you want.';
        blocks.push({
            type: 'text',
            text: await composeDashboardAssistantText({
                userMessage: dto.message,
                conversationContext,
                factualContext: compactFacts({ missingFields: prepared.missingFields, values: prepared.pendingAction.values }),
                defaultText,
            }),
        });
        blocks.push(...prepared.blocks);
    } else if (classification.intent === 'CREATE_AR_INVOICE') {
        const prepared = await prepareArInvoiceFromMessage(tenantId, dto.message, nextPendingAction);
        nextPendingAction = prepared.pendingAction;
        const defaultText = prepared.missingFields.length > 0
            ? `I prepared the customer invoice form. I still need: ${prepared.missingFields.join(', ')}.`
            : 'I prepared the customer invoice details. Review them and choose the action you want.';
        blocks.push({
            type: 'text',
            text: await composeDashboardAssistantText({
                userMessage: dto.message,
                conversationContext,
                factualContext: compactFacts({ missingFields: prepared.missingFields, values: prepared.pendingAction.values }),
                defaultText,
            }),
        });
        blocks.push(...prepared.blocks);
    } else if (classification.intent === 'CREATE_PURCHASE_ORDER') {
        const prepared = await preparePurchaseOrderFromMessage(tenantId, dto.message, nextPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({
            type: 'text',
            text: prepared.missingFields.length > 0
                ? `I prepared the purchase order form. I still need: ${prepared.missingFields.join(', ')}.`
                : 'I prepared the purchase order details. Review them and choose the action you want.',
        });
        blocks.push(...prepared.blocks);
    } else if (classification.intent === 'CREATE_GRN') {
        const prepared = await prepareGrnFromMessage(tenantId, dto.message, nextPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({
            type: 'text',
            text: prepared.missingFields.length > 0
                ? `I prepared the goods receipt form. I still need: ${prepared.missingFields.join(', ')}.`
                : 'I prepared the goods receipt details. Review them and choose the action you want.',
        });
        blocks.push(...prepared.blocks);
    } else if (classification.intent === 'CREATE_AP_INVOICE') {
        const prepared = await prepareApInvoiceFromMessage(tenantId, dto.message, nextPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({
            type: 'text',
            text: prepared.missingFields.length > 0
                ? `I prepared the vendor bill form. I still need: ${prepared.missingFields.join(', ')}.`
                : 'I prepared the vendor bill details. Review them and choose the action you want.',
        });
        blocks.push(...prepared.blocks);
    } else if (classification.intent === 'CREATE_AR_RECEIPT') {
        const prepared = await prepareArReceiptFromMessage(tenantId, dto.message, nextPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({
            type: 'text',
            text: prepared.missingFields.length > 0
                ? `I prepared the customer receipt form. I still need: ${prepared.missingFields.join(', ')}.`
                : 'I prepared the customer receipt details. Review them and choose the action you want.',
        });
        blocks.push(...prepared.blocks);
    } else if (classification.intent === 'CREATE_AP_PAYMENT') {
        const prepared = await prepareApPaymentFromMessage(tenantId, dto.message, nextPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({
            type: 'text',
            text: prepared.missingFields.length > 0
                ? `I prepared the vendor payment form. I still need: ${prepared.missingFields.join(', ')}.`
                : 'I prepared the vendor payment details. Review them and choose the action you want.',
        });
        blocks.push(...prepared.blocks);
    } else if (classification.intent === 'CREATE_CHART_ACCOUNT') {
        const prepared = await prepareChartAccountFromMessage(tenantId, dto.message, nextPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({
            type: 'text',
            text: prepared.missingFields.length > 0
                ? `I prepared the chart account form. I still need: ${prepared.missingFields.join(', ')}.`
                : 'I prepared the chart account details. Review them and submit when you are ready.',
        });
        blocks.push(...prepared.blocks);
    } else if (classification.intent === 'CREATE_FISCAL_YEAR') {
        const prepared = await prepareFiscalYearFromMessage(tenantId, dto.message, nextPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({
            type: 'text',
            text: prepared.missingFields.length > 0
                ? `I prepared the fiscal year form. I still need: ${prepared.missingFields.join(', ')}.`
                : 'I prepared the fiscal year details. Review them and submit when you are ready.',
        });
        blocks.push(...prepared.blocks);
    } else if (classification.intent === 'CREATE_BUSINESS_PARTNER') {
        const prepared = await prepareBusinessPartnerFromMessage(tenantId, dto.message, nextPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({
            type: 'text',
            text: prepared.missingFields.length > 0
                ? `I prepared the business partner form. I still need: ${prepared.missingFields.join(', ')}.`
                : 'I prepared the business partner details. Review them and submit when you are ready.',
        });
        blocks.push(...prepared.blocks);
    } else if (classification.intent === 'CREATE_PRODUCT') {
        const prepared = await prepareProductFromMessage(tenantId, dto.message, nextPendingAction);
        const activation = activatePreparedWorkflow({
            session,
            stack: workflowStack,
            activeWorkflowId: session.activeWorkflowId,
            prepared,
            formType: 'CREATE_PRODUCT',
        });
        nextPendingAction = session.pendingAction;
        blocks.push(...activation.blocks);
        blocks.push({
            type: 'text',
            text: prepared.missingFields.length > 0
                ? `I prepared the product form. I still need: ${prepared.missingFields.join(', ')}.`
                : 'I prepared the product details. Review them and submit when you are ready.',
        });
        blocks.push(...prepared.blocks);
    } else if (classification.intent === 'FIELDS_MISSING' && continuationPendingAction) {
        const prepared = await (async () => {
            switch (continuationPendingAction.formType) {
                case 'CREATE_CATEGORY': return prepareCategoryFromMessage(tenantId, dto.message, continuationPendingAction);
                case 'CREATE_UOM': return prepareUomFromMessage(tenantId, dto.message, continuationPendingAction);
                case 'CREATE_RFQ': return prepareRfqFromMessage(tenantId, dto.message, continuationPendingAction);
                case 'CREATE_AR_INVOICE': return prepareArInvoiceFromMessage(tenantId, dto.message, continuationPendingAction);
                case 'CREATE_PURCHASE_ORDER': return preparePurchaseOrderFromMessage(tenantId, dto.message, continuationPendingAction);
                case 'CREATE_GRN': return prepareGrnFromMessage(tenantId, dto.message, continuationPendingAction);
                case 'CREATE_AP_INVOICE': return prepareApInvoiceFromMessage(tenantId, dto.message, continuationPendingAction);
                case 'CREATE_AR_RECEIPT': return prepareArReceiptFromMessage(tenantId, dto.message, continuationPendingAction);
                case 'CREATE_AP_PAYMENT': return prepareApPaymentFromMessage(tenantId, dto.message, continuationPendingAction);
                case 'CREATE_CHART_ACCOUNT': return prepareChartAccountFromMessage(tenantId, dto.message, continuationPendingAction);
                case 'CREATE_FISCAL_YEAR': return prepareFiscalYearFromMessage(tenantId, dto.message, continuationPendingAction);
                case 'CREATE_BUSINESS_PARTNER': return prepareBusinessPartnerFromMessage(tenantId, dto.message, continuationPendingAction);
                case 'CREATE_PRODUCT': return prepareProductFromMessage(tenantId, dto.message, continuationPendingAction);
                default: return prepareProductFromMessage(tenantId, dto.message, continuationPendingAction);
            }
        })();
        nextPendingAction = prepared.pendingAction;
        blocks.push({
            type: 'text',
            text: prepared.missingFields.length
                ? `I updated the ${assistantModuleRegistry[nextPendingAction.formType].title.toLowerCase()} form. I still need: ${prepared.missingFields.join(', ')}.`
                : `The ${assistantModuleRegistry[nextPendingAction.formType].title.toLowerCase()} form now has the required fields. You can choose the action you want.`,
        });
        blocks.push(...prepared.blocks);
    } else if (continuationPendingAction?.formType === 'CREATE_CATEGORY') {
        const prepared = await prepareCategoryFromMessage(tenantId, dto.message, continuationPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({ type: 'text', text: prepared.missingFields.length ? `I updated the category details with what I could infer. I still need: ${prepared.missingFields.join(', ')}.` : 'I updated the category details with your latest input.' });
        blocks.push(...prepared.blocks);
    } else if (continuationPendingAction?.formType === 'CREATE_UOM') {
        const prepared = await prepareUomFromMessage(tenantId, dto.message, continuationPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({ type: 'text', text: prepared.missingFields.length ? `I updated the UOM details with what I could infer. I still need: ${prepared.missingFields.join(', ')}.` : 'I updated the UOM details with your latest input.' });
        blocks.push(...prepared.blocks);
    } else if (continuationPendingAction?.formType === 'CREATE_RFQ') {
        const prepared = await prepareRfqFromMessage(tenantId, dto.message, continuationPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({ type: 'text', text: prepared.missingFields.length ? `I updated the RFQ with what I could infer. I still need: ${prepared.missingFields.join(', ')}.` : 'I updated the RFQ details with your latest input.' });
        blocks.push(...prepared.blocks);
    } else if (continuationPendingAction?.formType === 'CREATE_AR_INVOICE') {
        const prepared = await prepareArInvoiceFromMessage(tenantId, dto.message, continuationPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({ type: 'text', text: prepared.missingFields.length ? `I updated the customer invoice with what I could infer. I still need: ${prepared.missingFields.join(', ')}.` : 'I updated the customer invoice details with your latest input.' });
        blocks.push(...prepared.blocks);
    } else if (continuationPendingAction?.formType === 'CREATE_PURCHASE_ORDER') {
        const prepared = await preparePurchaseOrderFromMessage(tenantId, dto.message, continuationPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({ type: 'text', text: prepared.missingFields.length ? `I updated the purchase order with what I could infer. I still need: ${prepared.missingFields.join(', ')}.` : 'I updated the purchase order details with your latest input.' });
        blocks.push(...prepared.blocks);
    } else if (continuationPendingAction?.formType === 'CREATE_GRN') {
        const prepared = await prepareGrnFromMessage(tenantId, dto.message, continuationPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({ type: 'text', text: prepared.missingFields.length ? `I updated the goods receipt with what I could infer. I still need: ${prepared.missingFields.join(', ')}.` : 'I updated the goods receipt details with your latest input.' });
        blocks.push(...prepared.blocks);
    } else if (continuationPendingAction?.formType === 'CREATE_AP_INVOICE') {
        const prepared = await prepareApInvoiceFromMessage(tenantId, dto.message, continuationPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({ type: 'text', text: prepared.missingFields.length ? `I updated the vendor bill with what I could infer. I still need: ${prepared.missingFields.join(', ')}.` : 'I updated the vendor bill details with your latest input.' });
        blocks.push(...prepared.blocks);
    } else if (continuationPendingAction?.formType === 'CREATE_AR_RECEIPT') {
        const prepared = await prepareArReceiptFromMessage(tenantId, dto.message, continuationPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({ type: 'text', text: prepared.missingFields.length ? `I updated the customer receipt with what I could infer. I still need: ${prepared.missingFields.join(', ')}.` : 'I updated the customer receipt details with your latest input.' });
        blocks.push(...prepared.blocks);
    } else if (continuationPendingAction?.formType === 'CREATE_AP_PAYMENT') {
        const prepared = await prepareApPaymentFromMessage(tenantId, dto.message, continuationPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({ type: 'text', text: prepared.missingFields.length ? `I updated the vendor payment with what I could infer. I still need: ${prepared.missingFields.join(', ')}.` : 'I updated the vendor payment details with your latest input.' });
        blocks.push(...prepared.blocks);
    } else if (continuationPendingAction?.formType === 'CREATE_CHART_ACCOUNT') {
        const prepared = await prepareChartAccountFromMessage(tenantId, dto.message, continuationPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({ type: 'text', text: prepared.missingFields.length ? `I updated the chart account form with what I could infer. I still need: ${prepared.missingFields.join(', ')}.` : 'I updated the chart account details with your latest input.' });
        blocks.push(...prepared.blocks);
    } else if (continuationPendingAction?.formType === 'CREATE_FISCAL_YEAR') {
        const prepared = await prepareFiscalYearFromMessage(tenantId, dto.message, continuationPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({ type: 'text', text: prepared.missingFields.length ? `I updated the fiscal year form with what I could infer. I still need: ${prepared.missingFields.join(', ')}.` : 'I updated the fiscal year details with your latest input.' });
        blocks.push(...prepared.blocks);
    } else if (continuationPendingAction?.formType === 'CREATE_BUSINESS_PARTNER') {
        const prepared = await prepareBusinessPartnerFromMessage(tenantId, dto.message, continuationPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({ type: 'text', text: prepared.missingFields.length ? `I updated the business partner form with what I could infer. I still need: ${prepared.missingFields.join(', ')}.` : 'I updated the business partner details with your latest input.' });
        blocks.push(...prepared.blocks);
    } else if (continuationPendingAction?.formType === 'CREATE_PRODUCT') {
        const prepared = await prepareProductFromMessage(tenantId, dto.message, continuationPendingAction);
        nextPendingAction = prepared.pendingAction;
        blocks.push({ type: 'text', text: prepared.missingFields.length ? `I updated the product form with what I could infer. I still need: ${prepared.missingFields.join(', ')}.` : 'I updated the product details with your latest input.' });
        blocks.push(...prepared.blocks);
    } else {
        const answer = await answerGroundedOperationalQuestion(tenantId, dto.message, overview);
        blocks.push({ type: 'text', text: answer.answer });
        if (/chart|trend|draw|plot/i.test(dto.message)) {
            const dashboardAnswer = await queryDashboard(tenantId, { question: dto.message });
            blocks.push(buildChartBlock(overview, dashboardAnswer.intent === 'INVENTORY' ? 'inventory_risk' : dashboardAnswer.intent === 'PROCUREMENT' ? 'document_throughput' : dashboardAnswer.intent === 'PAYABLES' || dashboardAnswer.intent === 'COLLECTIONS' ? 'overdue_balances' : 'cash_flow'));
        }
    }

    if (shouldPauseWorkflow && nextPendingAction) {
        const activeNode = getActiveWorkflowNode(workflowStack, session.activeWorkflowId);
        if (activeNode) {
            activeNode.status = 'paused';
            activeNode.missingFields = computeMissingFields(activeNode.formType, activeNode.values);
            activeNode.summary = `${assistantModuleRegistry[activeNode.formType].title} is paused while another question is answered.`;
            upsertWorkflowNode(workflowStack, activeNode);
            syncSessionWorkflowState(session, workflowStack, null);
        }
        previousFormStatus = 'paused';
        const pausedMissingFields = computeMissingFields(nextPendingAction.formType, nextPendingAction.values);
        nextWorkflowState = deriveWorkflowState(nextPendingAction, pausedMissingFields, 'paused');
        blocks.push({
            type: 'workflow_paused',
            formType: nextPendingAction.formType,
            summary: `${assistantModuleRegistry[nextPendingAction.formType].title} is paused while I answer this question.`,
            missingFields: pausedMissingFields,
        });
    } else if (nextPendingAction && blocks.some((block) => block.type === 'form_request')) {
        const currentFormBlock = blocks.find((block) => block.type === 'form_request') as Extract<ChatBlock, { type: 'form_request' }> | undefined;
        nextWorkflowState = deriveWorkflowState(nextPendingAction, currentFormBlock?.missingFields || []);
        if (session.activeWorkflowId) {
            const activeNode = getActiveWorkflowNode(workflowStack, session.activeWorkflowId);
            if (activeNode) {
                activeNode.values = nextPendingAction.values;
                activeNode.options = nextPendingAction.options;
                activeNode.executionModes = nextPendingAction.executionModes;
                activeNode.defaultExecutionMode = nextPendingAction.defaultExecutionMode;
                activeNode.missingFields = currentFormBlock?.missingFields || computeMissingFields(activeNode.formType, activeNode.values);
                activeNode.status = activeNode.missingFields.length ? 'collecting' : 'awaiting_confirm';
                activeNode.summary = `${assistantModuleRegistry[activeNode.formType].title} is ${activeNode.status === 'collecting' ? 'missing required details' : 'ready for confirmation'}.`;
                upsertWorkflowNode(workflowStack, activeNode);
                syncSessionWorkflowState(session, workflowStack, activeNode.id);
            }
        }
    } else if (!nextPendingAction && !nextWorkflowState) {
        nextWorkflowState = { status: 'idle', missingFields: [], summary: 'No active workflow.' };
        syncSessionWorkflowState(session, workflowStack, null);
    }

    const assistantTurn = await persistAssistantTurn(
        session,
        blocks,
        session.pendingAction ?? nextPendingAction,
        classification.intent,
        session.workflowState ?? nextWorkflowState,
        previousFormStatus,
    );

    return {
        session: mapSession(session.toObject()),
        assistantTurn,
    };
}

function buildRecordCreatedBlocks(params: {
    formType: AssistantFormType;
    recordId: string;
    recordNo: string;
    summary: string;
    detail: string;
    executionMode?: AssistantExecutionMode;
}) {
    const registry = assistantModuleRegistry[params.formType];
    return [
        {
            type: 'completed_form_summary',
            formType: params.formType,
            title: `${registry.title} completed`,
            summary: params.summary,
            recordNo: params.recordNo,
            executionMode: params.executionMode,
        } as ChatBlock,
        { type: 'action_summary', title: `${registry.title} completed`, detail: params.detail } as ChatBlock,
        {
            type: 'record_created',
            entityType: registry.entityType,
            recordId: params.recordId,
            recordNo: params.recordNo,
            destination: `${registry.destinationBase}?id=${params.recordId}`,
            summary: params.summary,
        } as ChatBlock,
    ];
}

async function persistCompletedWorkflowTurn(
    session: any,
    formType: AssistantFormType,
    blocks: ChatBlock[],
    lastIntent: string,
    executionMode?: AssistantExecutionMode,
) {
    syncSessionWorkflowState(session, [], null);
    return persistAssistantTurn(
        session,
        blocks,
        null,
        lastIntent,
        {
            status: 'completed',
            formType,
            missingFields: [],
            executionMode,
            summary: `${assistantModuleRegistry[formType].title} workflow completed.`,
        },
        'completed',
    );
}

function completeWorkflowExecution(params: {
    session: any;
    workflowStack: WorkflowNode[];
    completedWorkflow: WorkflowNode | null;
    created: { id: string; name?: string; code?: string; uomId?: string };
}) {
    if (!params.completedWorkflow) {
        syncSessionWorkflowState(params.session, [], null);
        return [] as ChatBlock[];
    }

    const remaining = params.workflowStack.filter((workflow) => workflow.id !== params.completedWorkflow!.id);
    if (params.completedWorkflow.parentWorkflowId) {
        const parent = remaining.find((workflow) => workflow.id === params.completedWorkflow!.parentWorkflowId);
        if (parent) {
            applyDependencyResultToParent(parent, params.completedWorkflow, params.created);
            parent.missingFields = computeMissingFields(parent.formType, parent.values);
            parent.status = parent.missingFields.length ? 'collecting' : 'awaiting_confirm';
            parent.summary = `${assistantModuleRegistry[parent.formType].title} is ${parent.status === 'collecting' ? 'missing required details' : 'ready for confirmation'}.`;
            upsertWorkflowNode(remaining, parent);
            syncSessionWorkflowState(params.session, remaining, parent.id);
            return [
                {
                    type: 'task_resumed',
                    workflowId: parent.id,
                    formType: parent.formType,
                    summary: `${assistantModuleRegistry[parent.formType].title} is active again with the new dependency filled in.`,
                } as ChatBlock,
                buildPendingActionFormBlock(toPendingAction(parent)!, 'active'),
            ];
        }
    }

    syncSessionWorkflowState(params.session, [], null);
    return [] as ChatBlock[];
}

export async function submitDashboardChatAction(tenantId: string, userId: string, dto: DashboardChatActionDTO) {
    const session = await DashboardChatSession.findOne({ _id: dto.sessionId, tenantId, userId });
    if (!session) throw new ServiceError('Dashboard chat session not found', 'NOT_FOUND');

    const workflowStack = getWorkflowStack(session);
    const activeWorkflowNode = getActiveWorkflowNode(workflowStack, session.activeWorkflowId);
    const pendingAction = session.pendingAction as PendingAction | null;
    const currentWorkflowState = (session.workflowState || session.workingState || null) as WorkflowState | null;
    const isConfirmExecution = dto.actionType === 'confirm_execution';

    if (dto.actionType === 'resume_workflow') {
        const workflowId = 'workflowId' in dto ? dto.workflowId : undefined;
        const targetWorkflow = (workflowId ? workflowStack.find((workflow) => workflow.id === workflowId) : getPausedWorkflowNodes(workflowStack)[0]) || activeWorkflowNode;
        if (!targetWorkflow) throw new ServiceError('No workflow is available to resume', 'INVALID_STATUS');
        targetWorkflow.status = targetWorkflow.missingFields.length ? 'collecting' : 'awaiting_confirm';
        upsertWorkflowNode(workflowStack, targetWorkflow);
        syncSessionWorkflowState(session, workflowStack, targetWorkflow.id);
        const resumedPendingAction = toPendingAction(targetWorkflow)!;
        const resumedBlock = buildPendingActionFormBlock(resumedPendingAction, 'active') as Extract<ChatBlock, { type: 'form_request' }>;
        const assistantTurn = await persistAssistantTurn(
            session,
            [
                {
                    type: 'task_resumed',
                    workflowId: targetWorkflow.id,
                    formType: targetWorkflow.formType,
                    summary: `${assistantModuleRegistry[targetWorkflow.formType].title} is active again.`,
                },
                {
                    type: 'workflow_resumed',
                    formType: targetWorkflow.formType,
                    summary: `${assistantModuleRegistry[targetWorkflow.formType].title} is active again.`,
                },
                resumedBlock,
            ],
            resumedPendingAction,
            'RESUME_WORKFLOW',
            deriveWorkflowState(resumedPendingAction, resumedBlock.missingFields),
            currentWorkflowState?.status === 'paused' ? 'superseded' : undefined,
        );
        return { session: mapSession(session.toObject()), assistantTurn };
    }

    if (dto.actionType === 'cancel_workflow') {
        const workflowId = 'workflowId' in dto ? dto.workflowId : undefined;
        const targetWorkflow = workflowId
            ? workflowStack.find((workflow) => workflow.id === workflowId)
            : activeWorkflowNode || getPausedWorkflowNodes(workflowStack)[0];
        if (!targetWorkflow) throw new ServiceError('No workflow is available to cancel', 'INVALID_STATUS');
        const nextStack = workflowStack.filter((workflow) => workflow.id !== targetWorkflow.id);
        const nextActive = targetWorkflow.parentWorkflowId && nextStack.some((workflow) => workflow.id === targetWorkflow.parentWorkflowId)
            ? targetWorkflow.parentWorkflowId
            : null;
        if (nextActive) {
            const parent = nextStack.find((workflow) => workflow.id === nextActive)!;
            parent.status = parent.missingFields.length ? 'collecting' : 'awaiting_confirm';
        }
        syncSessionWorkflowState(session, nextStack, nextActive);
        const assistantTurn = await persistAssistantTurn(
            session,
            [
                {
                    type: 'action_summary',
                    title: 'Workflow cancelled',
                    detail: `${assistantModuleRegistry[targetWorkflow.formType].title} is no longer active in this chat.`,
                },
            ],
            session.pendingAction || null,
            'CANCEL_WORKFLOW',
            session.workflowState || {
                status: 'cancelled',
                formType: targetWorkflow.formType,
                missingFields: [],
                executionMode: targetWorkflow.executionMode,
                summary: `${assistantModuleRegistry[targetWorkflow.formType].title} workflow was cancelled.`,
            },
            currentWorkflowState?.status === 'paused' ? 'superseded' : 'completed',
        );
        return { session: mapSession(session.toObject()), assistantTurn };
    }

    if (dto.actionType === 'confirm_execution') {
        const workflowId = 'workflowId' in dto ? dto.workflowId : undefined;
        const targetWorkflow = (workflowId ? workflowStack.find((workflow) => workflow.id === workflowId) : activeWorkflowNode);
        if (!targetWorkflow) throw new ServiceError('No workflow is ready to execute', 'INVALID_STATUS');
        if (targetWorkflow.missingFields.length > 0) throw new ServiceError('This workflow is still missing required fields', 'VALIDATION_ERROR');
        targetWorkflow.status = 'executing';
        targetWorkflow.summary = `${assistantModuleRegistry[targetWorkflow.formType].title} is executing.`;
        upsertWorkflowNode(workflowStack, targetWorkflow);
        syncSessionWorkflowState(session, workflowStack, targetWorkflow.id);
        dto = {
            sessionId: dto.sessionId,
            actionType: 'submit_form',
            formType: targetWorkflow.formType,
            values: targetWorkflow.values,
            executionMode: targetWorkflow.executionMode,
        };
    }

    const submitDto = dto;

    const targetWorkflow = activeWorkflowNode || (submitDto.formType && workflowStack.find((workflow) => workflow.formType === submitDto.formType)) || null;
    if (dto.actionType === 'submit_form' && !isConfirmExecution) {
        const mergedValues = { ...(targetWorkflow?.values || {}), ...submitDto.values };
        const missingFields = computeMissingFields(submitDto.formType, mergedValues);
        const executionMode = submitDto.executionMode || targetWorkflow?.executionMode || pendingAction?.defaultExecutionMode || 'SAVE';
        const nextWorkflow = createWorkflowNode({
            pendingAction: {
                formType: submitDto.formType,
                values: mergedValues,
                options: targetWorkflow?.options || pendingAction?.options || {},
                executionModes: targetWorkflow?.executionModes || pendingAction?.executionModes || getExecutionChoices(submitDto.formType),
                defaultExecutionMode: targetWorkflow?.defaultExecutionMode || pendingAction?.defaultExecutionMode || executionMode,
            },
            id: targetWorkflow?.id,
            parentWorkflowId: targetWorkflow?.parentWorkflowId,
            missingFields,
            status: missingFields.length ? 'collecting' : 'awaiting_confirm',
            executionMode,
        });
        upsertWorkflowNode(workflowStack, nextWorkflow);
        syncSessionWorkflowState(session, workflowStack, nextWorkflow.id);

        const stagedBlocks: ChatBlock[] = [
            buildPendingActionFormBlock(toPendingAction(nextWorkflow)!, 'active'),
        ];

        if (missingFields.length) {
            stagedBlocks.unshift({
                type: 'validation_summary',
                title: `${assistantModuleRegistry[nextWorkflow.formType].title} still needs a few details`,
                missingFields,
            });
            const assistantTurn = await persistAssistantTurn(
                session,
                stagedBlocks,
                session.pendingAction,
                'SUBMIT_FORM',
                session.workflowState,
                undefined,
            );
            return { session: mapSession(session.toObject()), assistantTurn };
        }

        stagedBlocks.unshift({
            type: 'task_summary',
            workflowId: nextWorkflow.id,
            formType: nextWorkflow.formType,
            summary: `${assistantModuleRegistry[nextWorkflow.formType].title} is ready. Confirm once to execute the real ERP action.`,
        });
        stagedBlocks.push({
            type: 'execution_preview',
            title: `${assistantModuleRegistry[nextWorkflow.formType].title} ready to execute`,
            detail: `Mode: ${executionMode.replace(/_/g, ' ')}. Confirm once and the assistant will run the same system flow as the normal module.`,
            workflowId: nextWorkflow.id,
            formType: nextWorkflow.formType,
            executionMode,
        });
        const assistantTurn = await persistAssistantTurn(
            session,
            stagedBlocks,
            session.pendingAction,
            'SUBMIT_FORM',
            session.workflowState,
            undefined,
        );
        return { session: mapSession(session.toObject()), assistantTurn };
    }

    if (!pendingAction || pendingAction.formType !== submitDto.formType) {
        throw new ServiceError('No matching pending assistant action was found', 'INVALID_STATUS');
    }

    const executionMode = submitDto.executionMode || pendingAction.defaultExecutionMode || 'SAVE';
    const vendorLabel = (pendingAction.options?.vendors || []).find((item: any) => item.id === submitDto.values.vendorId)?.name || submitDto.values.vendorName;
    const customerLabel = (pendingAction.options?.customers || []).find((item: any) => item.id === submitDto.values.customerId)?.name || submitDto.values.customerName;

    if (submitDto.formType === 'CREATE_CHART_ACCOUNT') {
        const validation = createAccountSchema.safeParse({
            code: submitDto.values.code,
            name: submitDto.values.name,
            type: submitDto.values.type,
            parentId: submitDto.values.parentId || null,
            isPosting: Boolean(submitDto.values.isPosting),
            description: submitDto.values.description || undefined,
        });
        if (!validation.success) throw new ServiceError('Chart account form validation failed', 'VALIDATION_ERROR', validation.error.format());
        const created = await chartOfAccountService.createAccount(validation.data, tenantId);
        const assistantTurn = await persistCompletedWorkflowTurn(
            session,
            'CREATE_CHART_ACCOUNT',
            buildRecordCreatedBlocks({
                formType: 'CREATE_CHART_ACCOUNT',
                recordId: created._id.toString(),
                recordNo: `${created.code} - ${created.name}`,
                summary: `Chart account ${created.code} - ${created.name} is ready in the chart of accounts.`,
                detail: 'The assistant created the chart account using the same validation rules as the accounting module.',
                executionMode,
            }),
            'CREATE_CHART_ACCOUNT'
        );
        return { session: mapSession(session.toObject()), assistantTurn };
    }

    if (submitDto.formType === 'CREATE_FISCAL_YEAR') {
        const validation = createFiscalYearSchema.safeParse({
            yearName: submitDto.values.yearName,
            startDate: submitDto.values.startDate,
            endDate: submitDto.values.endDate,
            isActive: submitDto.values.isActive,
            generatePeriods: submitDto.values.generatePeriods,
        });
        if (!validation.success) throw new ServiceError('Fiscal year form validation failed', 'VALIDATION_ERROR', validation.error.format());
        const created = await fiscalService.createFiscalYear(tenantId, validation.data);
        const assistantTurn = await persistCompletedWorkflowTurn(
            session,
            'CREATE_FISCAL_YEAR',
            buildRecordCreatedBlocks({
                formType: 'CREATE_FISCAL_YEAR',
                recordId: created!._id.toString(),
                recordNo: created!.yearName,
                summary: `Fiscal year ${created!.yearName} is now available in the fiscal calendar.`,
                detail: 'The assistant created the fiscal year using the selected date range and period generation settings.',
                executionMode,
            }),
            'CREATE_FISCAL_YEAR'
        );
        return { session: mapSession(session.toObject()), assistantTurn };
    }

    if (submitDto.formType === 'CREATE_BUSINESS_PARTNER') {
        const validation = createBusinessPartnerSchema.safeParse({
            name: submitDto.values.name,
            roles: submitDto.values.roles,
            currency: submitDto.values.currency,
            status: submitDto.values.status,
            taxNumber: submitDto.values.taxNumber,
            email: submitDto.values.email,
            phone: submitDto.values.phone,
            paymentTerms: submitDto.values.paymentTerms,
            creditLimit: submitDto.values.creditLimit === '' || submitDto.values.creditLimit === null || submitDto.values.creditLimit === undefined ? undefined : Number(submitDto.values.creditLimit),
            address: submitDto.values.address || {},
        });
        if (!validation.success) throw new ServiceError('Business partner form validation failed', 'VALIDATION_ERROR', validation.error.format());
        const created = await businessPartnerService.createBusinessPartner(validation.data, tenantId);
        const assistantTurn = await persistCompletedWorkflowTurn(
            session,
            'CREATE_BUSINESS_PARTNER',
            buildRecordCreatedBlocks({
                formType: 'CREATE_BUSINESS_PARTNER',
                recordId: created._id.toString(),
                recordNo: `${created.code} - ${created.name}`,
                summary: `Business partner ${created.code} - ${created.name} is ready in master data.`,
                detail: 'The assistant created the business partner using the same master-data rules as the normal form.',
                executionMode,
            }),
            'CREATE_BUSINESS_PARTNER'
        );
        return { session: mapSession(session.toObject()), assistantTurn };
    }

    if (submitDto.formType === 'CREATE_CATEGORY') {
        const validation = categorySchema.safeParse({
            name: submitDto.values.name,
            status: submitDto.values.status || 'ACTIVE',
        });
        if (!validation.success) throw new ServiceError('Category form validation failed', 'VALIDATION_ERROR', validation.error.format());
        const created = await inventoryService.createCategory(tenantId, validation.data as any);
        const followUpBlocks = completeWorkflowExecution({
            session,
            workflowStack,
            completedWorkflow: activeWorkflowNode,
            created: { id: created._id.toString(), name: created.name },
        });
        const assistantTurn = await persistAssistantTurn(
            session,
            [
                ...buildRecordCreatedBlocks({
                    formType: 'CREATE_CATEGORY',
                    recordId: created._id.toString(),
                    recordNo: created.name,
                    summary: `Category ${created.name} is now available for inventory setup.`,
                    detail: 'The assistant created the inventory category and returned to the blocked parent task if one existed.',
                    executionMode,
                }),
                ...followUpBlocks,
            ],
            session.pendingAction || null,
            'CREATE_CATEGORY',
            session.workflowState,
            'completed',
        );
        return { session: mapSession(session.toObject()), assistantTurn };
    }

    if (submitDto.formType === 'CREATE_UOM') {
        const validation = uomSchema.safeParse({
            name: submitDto.values.name,
            symbol: submitDto.values.symbol,
            status: submitDto.values.status || 'ACTIVE',
        });
        if (!validation.success) throw new ServiceError('UOM form validation failed', 'VALIDATION_ERROR', validation.error.format());
        const created = await inventoryService.createUom(tenantId, validation.data as any);
        const followUpBlocks = completeWorkflowExecution({
            session,
            workflowStack,
            completedWorkflow: activeWorkflowNode,
            created: { id: created._id.toString(), name: created.name },
        });
        const assistantTurn = await persistAssistantTurn(
            session,
            [
                ...buildRecordCreatedBlocks({
                    formType: 'CREATE_UOM',
                    recordId: created._id.toString(),
                    recordNo: `${created.symbol} - ${created.name}`,
                    summary: `UOM ${created.symbol} - ${created.name} is now available for item and transaction setup.`,
                    detail: 'The assistant created the unit of measure and returned to the blocked parent task if one existed.',
                    executionMode,
                }),
                ...followUpBlocks,
            ],
            session.pendingAction || null,
            'CREATE_UOM',
            session.workflowState,
            'completed',
        );
        return { session: mapSession(session.toObject()), assistantTurn };
    }

    if (submitDto.formType === 'CREATE_PRODUCT') {
        const validation = productSchema.safeParse({
            name: submitDto.values.name,
            type: submitDto.values.type,
            categoryId: submitDto.values.categoryId,
            uomId: submitDto.values.uomId,
            unitPrice: Number(submitDto.values.unitPrice),
            costPrice: submitDto.values.costPrice === '' || submitDto.values.costPrice === null || submitDto.values.costPrice === undefined ? undefined : Number(submitDto.values.costPrice),
            vatRate: Number(submitDto.values.vatRate ?? 5),
            inventoryTracked: Boolean(submitDto.values.inventoryTracked),
            status: submitDto.values.status,
        });
        if (!validation.success) throw new ServiceError('Product form validation failed', 'VALIDATION_ERROR', validation.error.format());
        const created = await inventoryService.createProduct(tenantId, validation.data as any);
        const followUpBlocks = completeWorkflowExecution({
            session,
            workflowStack,
            completedWorkflow: activeWorkflowNode,
            created: { id: created._id.toString(), name: created.name, code: created.code, uomId: created.uomId?.toString?.() || '' },
        });
        const assistantTurn = await persistAssistantTurn(
            session,
            [
                ...buildRecordCreatedBlocks({
                    formType: 'CREATE_PRODUCT',
                    recordId: created._id.toString(),
                    recordNo: `${created.code} - ${created.name}`,
                    summary: `Item ${created.code} - ${created.name} is now available in inventory.`,
                    detail: 'The assistant created the product or service master record inside inventory.',
                    executionMode,
                }),
                ...followUpBlocks,
            ],
            session.pendingAction || null,
            'CREATE_PRODUCT',
            session.workflowState,
            'completed',
        );
        return { session: mapSession(session.toObject()), assistantTurn };
    }

    if (submitDto.formType === 'CREATE_RFQ') {
        const validation = createRFQSchema.safeParse({
            title: submitDto.values.title,
            vendorIds: submitDto.values.vendorIds,
            items: (submitDto.values.items || []).map((item: any) => ({
                productId: item.productId || undefined,
                description: item.description,
                quantity: Number(item.quantity),
                uomId: item.uomId,
            })),
        });
        if (!validation.success) throw new ServiceError('RFQ form validation failed', 'VALIDATION_ERROR', validation.error.format());
        let created = await rfqService.createRFQ(validation.data, tenantId);
        if (executionMode === 'CREATE_AND_SEND') {
            created = await rfqService.sendRFQ(created._id.toString(), tenantId);
        }
        const assistantTurn = await persistCompletedWorkflowTurn(
            session,
            'CREATE_RFQ',
            buildRecordCreatedBlocks({
                formType: 'CREATE_RFQ',
                recordId: created._id.toString(),
                recordNo: created.rfqNumber,
                summary: executionMode === 'CREATE_AND_SEND' ? `RFQ ${created.rfqNumber} was created and sent to vendors.` : `RFQ ${created.rfqNumber} is ready for review.`,
                detail: executionMode === 'CREATE_AND_SEND' ? 'The assistant created the RFQ and sent it using the live RFQ workflow.' : 'The assistant created the RFQ in draft status.',
                executionMode,
            }),
            'CREATE_RFQ'
        );
        return { session: mapSession(session.toObject()), assistantTurn };
    }

    if (submitDto.formType === 'CREATE_AR_INVOICE') {
        const validation = createARInvoiceSchema.safeParse({
            customerId: submitDto.values.customerId,
            invoiceDate: submitDto.values.invoiceDate,
            postingDate: submitDto.values.postingDate,
            dueDate: submitDto.values.dueDate,
            currency: submitDto.values.currency,
            notes: submitDto.values.notes,
            items: (submitDto.values.items || []).map((item: any) => ({
                lineType: item.lineType || 'MANUAL',
                productId: item.productId || undefined,
                itemKind: item.itemKind || undefined,
                description: item.description,
                quantity: Number(item.quantity),
                unitPrice: Number(item.unitPrice),
            })),
            accounting: {
                revenueAccountId: submitDto.values.accounting?.revenueAccountId,
                arAccountId: submitDto.values.accounting?.arAccountId,
            },
        });
        if (!validation.success) throw new ServiceError('Customer invoice form validation failed', 'VALIDATION_ERROR', validation.error.format());
        let created = await arInvoiceService.create(validation.data, tenantId);
        if (executionMode === 'CREATE_AND_POST') {
            created = await arInvoiceService.post(created.id, tenantId);
        }
        const assistantTurn = await persistCompletedWorkflowTurn(
            session,
            'CREATE_AR_INVOICE',
            buildRecordCreatedBlocks({
                formType: 'CREATE_AR_INVOICE',
                recordId: created.id,
                recordNo: created.invoiceNo,
                summary: executionMode === 'CREATE_AND_POST' ? `Customer invoice ${created.invoiceNo} was created and posted.` : `Customer invoice ${created.invoiceNo} is ready for review.`,
                detail: executionMode === 'CREATE_AND_POST' ? 'The assistant created and posted the invoice using the same receivables workflow as the normal module.' : 'The assistant created the customer invoice in draft status.',
                executionMode,
            }),
            'CREATE_AR_INVOICE'
        );
        return { session: mapSession(session.toObject()), assistantTurn };
    }

    if (submitDto.formType === 'CREATE_PURCHASE_ORDER') {
        const validation = createPOChatSchema.safeParse({
            vendorId: submitDto.values.vendorId,
            orderDate: submitDto.values.orderDate,
            expectedDeliveryDate: submitDto.values.expectedDeliveryDate || undefined,
            currency: submitDto.values.currency,
            notes: submitDto.values.notes,
            lines: (submitDto.values.lines || []).map((item: any) => ({
                productId: item.productId || undefined,
                uomId: item.uomId || undefined,
                description: item.description,
                quantity: Number(item.quantity),
                unitPrice: Number(item.unitPrice),
                vatRate: Number(item.vatRate ?? 0),
            })),
        });
        if (!validation.success) throw new ServiceError('Purchase order form validation failed', 'VALIDATION_ERROR', validation.error.format());
        let created = await purchaseOrderService.create(validation.data, tenantId);
        if (executionMode === 'CREATE_AND_APPROVE') {
            created = await purchaseOrderService.approve(created._id.toString(), tenantId);
        }
        const assistantTurn = await persistCompletedWorkflowTurn(
            session,
            'CREATE_PURCHASE_ORDER',
            buildRecordCreatedBlocks({
                formType: 'CREATE_PURCHASE_ORDER',
                recordId: created._id.toString(),
                recordNo: created.poNumber,
                summary: executionMode === 'CREATE_AND_APPROVE' ? `Purchase order ${created.poNumber} was created and approved.` : `Purchase order ${created.poNumber} is ready for review.`,
                detail: executionMode === 'CREATE_AND_APPROVE' ? 'The assistant created and approved the purchase order using the purchasing workflow.' : 'The assistant created the purchase order in draft status.',
                executionMode,
            }),
            'CREATE_PURCHASE_ORDER'
        );
        return { session: mapSession(session.toObject()), assistantTurn };
    }

    if (submitDto.formType === 'CREATE_GRN') {
        const validation = createGRNSchema.safeParse({
            poId: submitDto.values.poId,
            receiptDate: submitDto.values.receiptDate,
            notes: submitDto.values.notes,
            lines: (submitDto.values.lines || []).map((item: any) => ({
                poLineIndex: Number(item.poLineIndex),
                productId: item.productId || undefined,
                receivedQty: Number(item.receivedQty),
                unitCost: item.unitCost === '' || item.unitCost === null || item.unitCost === undefined ? undefined : Number(item.unitCost),
            })),
        });
        if (!validation.success) throw new ServiceError('Goods receipt form validation failed', 'VALIDATION_ERROR', validation.error.format());
        let created = await grnService.create(validation.data, tenantId);
        if (executionMode === 'CREATE_AND_CONFIRM') {
            created = await grnService.confirm(created._id.toString(), tenantId);
        }
        const assistantTurn = await persistCompletedWorkflowTurn(
            session,
            'CREATE_GRN',
            buildRecordCreatedBlocks({
                formType: 'CREATE_GRN',
                recordId: created._id.toString(),
                recordNo: created.grnNo,
                summary: executionMode === 'CREATE_AND_CONFIRM' ? `Goods receipt ${created.grnNo} was created and confirmed.` : `Goods receipt ${created.grnNo} is ready for review.`,
                detail: executionMode === 'CREATE_AND_CONFIRM' ? 'The assistant created and confirmed the goods receipt using the live stock and accounting flow.' : 'The assistant created the goods receipt in draft status.',
                executionMode,
            }),
            'CREATE_GRN'
        );
        return { session: mapSession(session.toObject()), assistantTurn };
    }

    if (submitDto.formType === 'CREATE_AP_INVOICE') {
        const validation = createAPInvoiceSchema.safeParse({
            vendorId: submitDto.values.vendorId,
            vendorName: vendorLabel || '',
            invoiceDate: submitDto.values.invoiceDate,
            postingDate: submitDto.values.postingDate,
            dueDate: submitDto.values.dueDate || undefined,
            currencyCode: submitDto.values.currencyCode,
            notes: submitDto.values.notes,
            source: submitDto.values.source?.purchaseOrderId ? {
                purchaseOrderId: submitDto.values.source.purchaseOrderId,
                poNo: submitDto.values.source.poNo,
            } : undefined,
            items: (submitDto.values.items || []).map((item: any) => ({
                description: item.description,
                quantity: Number(item.quantity),
                unitPrice: Number(item.unitPrice),
            })),
            accounting: {
                expenseAccountId: submitDto.values.accounting?.expenseAccountId,
                apAccountId: submitDto.values.accounting?.apAccountId,
            },
        });
        if (!validation.success) throw new ServiceError('Vendor bill form validation failed', 'VALIDATION_ERROR', validation.error.format());
        let created = await apInvoiceService.create(validation.data, tenantId);
        if (executionMode === 'CREATE_AND_POST') {
            created = await apInvoiceService.post(created._id.toString(), tenantId);
        }
        const assistantTurn = await persistCompletedWorkflowTurn(
            session,
            'CREATE_AP_INVOICE',
            buildRecordCreatedBlocks({
                formType: 'CREATE_AP_INVOICE',
                recordId: created._id.toString(),
                recordNo: created.invoiceNo,
                summary: executionMode === 'CREATE_AND_POST' ? `Vendor bill ${created.invoiceNo} was created and posted.` : `Vendor bill ${created.invoiceNo} is ready for review.`,
                detail: executionMode === 'CREATE_AND_POST' ? 'The assistant created and posted the vendor bill using the payables workflow.' : 'The assistant created the vendor bill in draft status.',
                executionMode,
            }),
            'CREATE_AP_INVOICE'
        );
        return { session: mapSession(session.toObject()), assistantTurn };
    }

    if (submitDto.formType === 'CREATE_AR_RECEIPT') {
        const validation = createARReceiptSchema.safeParse({
            customerId: submitDto.values.customerId,
            receiptDate: submitDto.values.receiptDate,
            postingDate: submitDto.values.postingDate,
            method: submitDto.values.method,
            bankAccountId: submitDto.values.bankAccountId,
            arAccountId: submitDto.values.arAccountId,
            amount: Number(submitDto.values.amount),
            memo: submitDto.values.memo,
            allocations: (submitDto.values.allocations || []).map((item: any) => ({
                invoiceId: item.invoiceId,
                invoiceNo: item.invoiceNo,
                allocatedAmount: Number(item.allocatedAmount),
            })),
        });
        if (!validation.success) throw new ServiceError('Customer receipt form validation failed', 'VALIDATION_ERROR', validation.error.format());
        let created = await arReceiptService.create(validation.data, tenantId);
        if (executionMode === 'CREATE_AND_POST') {
            created = await arReceiptService.post(created.id, tenantId);
        }
        const assistantTurn = await persistCompletedWorkflowTurn(
            session,
            'CREATE_AR_RECEIPT',
            buildRecordCreatedBlocks({
                formType: 'CREATE_AR_RECEIPT',
                recordId: created.id,
                recordNo: created.receiptNo,
                summary: executionMode === 'CREATE_AND_POST' ? `Customer receipt ${created.receiptNo} was created and posted.` : `Customer receipt ${created.receiptNo} is ready for review.`,
                detail: executionMode === 'CREATE_AND_POST' ? 'The assistant created and posted the customer receipt using the receivables workflow.' : 'The assistant created the customer receipt in draft status.',
                executionMode,
            }),
            'CREATE_AR_RECEIPT'
        );
        return { session: mapSession(session.toObject()), assistantTurn };
    }

    const validation = createAPPaymentSchema.safeParse({
        vendorId: submitDto.values.vendorId,
        vendorName: vendorLabel || '',
        paymentDate: submitDto.values.paymentDate,
        postingDate: submitDto.values.postingDate,
        method: submitDto.values.method,
        apAccountId: submitDto.values.apAccountId,
        paymentAccountId: submitDto.values.paymentAccountId,
        amount: Number(submitDto.values.amount),
        memo: submitDto.values.memo,
        allocations: (submitDto.values.allocations || []).map((item: any) => ({
            invoiceId: item.invoiceId,
            invoiceNo: item.invoiceNo,
            allocatedAmount: Number(item.allocatedAmount),
        })),
    });
    if (!validation.success) throw new ServiceError('Vendor payment form validation failed', 'VALIDATION_ERROR', validation.error.format());
    let created = await apPaymentService.create(validation.data, tenantId);
    if (executionMode === 'CREATE_AND_POST') {
        created = await apPaymentService.post(created.id, tenantId);
    }
    const assistantTurn = await persistCompletedWorkflowTurn(
        session,
        'CREATE_AP_PAYMENT',
        buildRecordCreatedBlocks({
            formType: 'CREATE_AP_PAYMENT',
            recordId: created.id,
            recordNo: created.paymentNo,
            summary: executionMode === 'CREATE_AND_POST' ? `Vendor payment ${created.paymentNo} was created and posted.` : `Vendor payment ${created.paymentNo} is ready for review.`,
            detail: executionMode === 'CREATE_AND_POST' ? 'The assistant created and posted the vendor payment using the payables workflow.' : 'The assistant created the vendor payment in draft status.',
            executionMode,
        }),
        'CREATE_AP_PAYMENT'
    );
    return { session: mapSession(session.toObject()), assistantTurn };
}

export async function downloadDashboardArtifact(tenantId: string, userId: string, artifactId: string) {
    const artifact = await DashboardArtifact.findOne({ _id: artifactId, tenantId });
    if (!artifact) throw new ServiceError('Dashboard export artifact not found', 'NOT_FOUND');

    const session = await DashboardChatSession.findOne({ _id: artifact.sessionId, tenantId, userId }).select('_id').lean();
    if (!session) throw new ServiceError('Artifact is not available for this user session', 'FORBIDDEN');

    return {
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        buffer: Buffer.from(artifact.dataBase64, 'base64'),
    };
}
