export type AssistantFormType =
    | 'CREATE_CATEGORY'
    | 'CREATE_UOM'
    | 'CREATE_RFQ'
    | 'CREATE_AR_INVOICE'
    | 'CREATE_PURCHASE_ORDER'
    | 'CREATE_GRN'
    | 'CREATE_AP_INVOICE'
    | 'CREATE_AR_RECEIPT'
    | 'CREATE_AP_PAYMENT'
    | 'CREATE_CHART_ACCOUNT'
    | 'CREATE_FISCAL_YEAR'
    | 'CREATE_BUSINESS_PARTNER'
    | 'CREATE_PRODUCT';

export type AssistantExecutionMode =
    | 'SAVE'
    | 'CREATE_AND_SEND'
    | 'CREATE_AND_APPROVE'
    | 'CREATE_AND_CONFIRM'
    | 'CREATE_AND_POST';

export type AssistantEntityType =
    | 'CATEGORY'
    | 'UOM'
    | 'RFQ'
    | 'AR_INVOICE'
    | 'PURCHASE_ORDER'
    | 'GRN'
    | 'AP_INVOICE'
    | 'AR_RECEIPT'
    | 'AP_PAYMENT'
    | 'CHART_ACCOUNT'
    | 'FISCAL_YEAR'
    | 'BUSINESS_PARTNER'
    | 'PRODUCT';

export interface AssistantExecutionChoice {
    mode: AssistantExecutionMode;
    label: string;
    summary: string;
    style?: 'primary' | 'secondary';
}

export interface AssistantModuleRegistryItem {
    formType: AssistantFormType;
    entityType: AssistantEntityType;
    title: string;
    destinationBase: string;
    executionChoices: AssistantExecutionChoice[];
}

export const assistantModuleRegistry: Record<AssistantFormType, AssistantModuleRegistryItem> = {
    CREATE_CATEGORY: {
        formType: 'CREATE_CATEGORY',
        entityType: 'CATEGORY',
        title: 'Category',
        destinationBase: '/inventory/products',
        executionChoices: [
            { mode: 'SAVE', label: 'Create Category', summary: 'Create the inventory category record.', style: 'primary' },
        ],
    },
    CREATE_UOM: {
        formType: 'CREATE_UOM',
        entityType: 'UOM',
        title: 'UOM',
        destinationBase: '/inventory/products',
        executionChoices: [
            { mode: 'SAVE', label: 'Create UOM', summary: 'Create the unit of measure record.', style: 'primary' },
        ],
    },
    CREATE_RFQ: {
        formType: 'CREATE_RFQ',
        entityType: 'RFQ',
        title: 'RFQ',
        destinationBase: '/rfqs',
        executionChoices: [
            { mode: 'SAVE', label: 'Save RFQ', summary: 'Create the RFQ in draft status.', style: 'secondary' },
            { mode: 'CREATE_AND_SEND', label: 'Create and Send', summary: 'Create the RFQ and send it to vendors immediately.', style: 'primary' },
        ],
    },
    CREATE_AR_INVOICE: {
        formType: 'CREATE_AR_INVOICE',
        entityType: 'AR_INVOICE',
        title: 'Customer Invoice',
        destinationBase: '/receivables/invoices',
        executionChoices: [
            { mode: 'SAVE', label: 'Save Invoice', summary: 'Create the invoice in draft status.', style: 'secondary' },
            { mode: 'CREATE_AND_POST', label: 'Create and Post', summary: 'Create the invoice and post it to the general ledger.', style: 'primary' },
        ],
    },
    CREATE_PURCHASE_ORDER: {
        formType: 'CREATE_PURCHASE_ORDER',
        entityType: 'PURCHASE_ORDER',
        title: 'Purchase Order',
        destinationBase: '/purchase-orders',
        executionChoices: [
            { mode: 'SAVE', label: 'Save PO', summary: 'Create the purchase order in draft status.', style: 'secondary' },
            { mode: 'CREATE_AND_APPROVE', label: 'Create and Approve', summary: 'Create the purchase order and approve it immediately.', style: 'primary' },
        ],
    },
    CREATE_GRN: {
        formType: 'CREATE_GRN',
        entityType: 'GRN',
        title: 'Goods Receipt',
        destinationBase: '/goods-receipts',
        executionChoices: [
            { mode: 'SAVE', label: 'Save GRN', summary: 'Create the goods receipt in draft status.', style: 'secondary' },
            { mode: 'CREATE_AND_CONFIRM', label: 'Create and Confirm', summary: 'Create the goods receipt and confirm stock/accounting impact.', style: 'primary' },
        ],
    },
    CREATE_AP_INVOICE: {
        formType: 'CREATE_AP_INVOICE',
        entityType: 'AP_INVOICE',
        title: 'Vendor Bill',
        destinationBase: '/ap-invoices',
        executionChoices: [
            { mode: 'SAVE', label: 'Save Vendor Bill', summary: 'Create the vendor bill in draft status.', style: 'secondary' },
            { mode: 'CREATE_AND_POST', label: 'Create and Post', summary: 'Create the vendor bill and post it to the general ledger.', style: 'primary' },
        ],
    },
    CREATE_AR_RECEIPT: {
        formType: 'CREATE_AR_RECEIPT',
        entityType: 'AR_RECEIPT',
        title: 'Customer Receipt',
        destinationBase: '/receivables/receipts',
        executionChoices: [
            { mode: 'SAVE', label: 'Save Receipt', summary: 'Create the receipt in draft status.', style: 'secondary' },
            { mode: 'CREATE_AND_POST', label: 'Create and Post', summary: 'Create the receipt and post it to the general ledger.', style: 'primary' },
        ],
    },
    CREATE_AP_PAYMENT: {
        formType: 'CREATE_AP_PAYMENT',
        entityType: 'AP_PAYMENT',
        title: 'Vendor Payment',
        destinationBase: '/payments',
        executionChoices: [
            { mode: 'SAVE', label: 'Save Payment', summary: 'Create the payment in draft status.', style: 'secondary' },
            { mode: 'CREATE_AND_POST', label: 'Create and Post', summary: 'Create the payment and post it to the general ledger.', style: 'primary' },
        ],
    },
    CREATE_CHART_ACCOUNT: {
        formType: 'CREATE_CHART_ACCOUNT',
        entityType: 'CHART_ACCOUNT',
        title: 'Chart Account',
        destinationBase: '/',
        executionChoices: [
            { mode: 'SAVE', label: 'Create Account', summary: 'Create the chart account record.', style: 'primary' },
        ],
    },
    CREATE_FISCAL_YEAR: {
        formType: 'CREATE_FISCAL_YEAR',
        entityType: 'FISCAL_YEAR',
        title: 'Fiscal Year',
        destinationBase: '/fiscal-calendar',
        executionChoices: [
            { mode: 'SAVE', label: 'Create Fiscal Year', summary: 'Create the fiscal year using the selected options.', style: 'primary' },
        ],
    },
    CREATE_BUSINESS_PARTNER: {
        formType: 'CREATE_BUSINESS_PARTNER',
        entityType: 'BUSINESS_PARTNER',
        title: 'Business Partner',
        destinationBase: '/business-partners',
        executionChoices: [
            { mode: 'SAVE', label: 'Create Partner', summary: 'Create the business partner master record.', style: 'primary' },
        ],
    },
    CREATE_PRODUCT: {
        formType: 'CREATE_PRODUCT',
        entityType: 'PRODUCT',
        title: 'Product / Service',
        destinationBase: '/inventory/products',
        executionChoices: [
            { mode: 'SAVE', label: 'Create Item', summary: 'Create the product or service master record.', style: 'primary' },
        ],
    },
};

export function getExecutionChoices(formType: AssistantFormType) {
    return assistantModuleRegistry[formType].executionChoices;
}
