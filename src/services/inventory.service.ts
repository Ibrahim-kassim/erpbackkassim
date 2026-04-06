import { Category, ICategory } from '../models/inventory/category.model';
import { Uom, IUom } from '../models/inventory/uom.model';
import { Product, IProduct } from '../models/inventory/product.model';
import { Stock, IStock } from '../models/inventory/stock.model';
import { Counter } from '../models/counter.model';
import type { ImportProductRowDTO } from '../validators/inventory.schema';

interface ProductListFilters {
    search?: string;
    type?: 'PRODUCT' | 'SERVICE' | 'ALL';
    categoryId?: string | 'ALL';
    status?: 'ACTIVE' | 'INACTIVE' | 'ALL';
}

function normalizeLookup(value: string) {
    return value.trim().toLowerCase();
}

type CategoryLookup = {
    _id: unknown;
    name: string;
};

type UomLookup = {
    _id: unknown;
    name: string;
    symbol: string;
};

// --- Helper: Generate Code ---
async function getNextSequence(tenantId: string, prefix: string): Promise<string> {
    const counter = await Counter.findOneAndUpdate(
        { tenantId, key: prefix }, // Group by tenant and prefix (e.g., 'PRD')
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    return `${prefix}-${counter.seq.toString().padStart(4, '0')}`;
}

// --- Categories ---
export async function createCategory(tenantId: string, data: Partial<ICategory>): Promise<ICategory> {
    const category = new Category({ ...data, tenantId });
    return category.save();
}

export async function listCategories(tenantId: string): Promise<ICategory[]> {
    return Category.find({ tenantId, isDeleted: false }).sort({ name: 1 });
}

export async function updateCategory(
    tenantId: string,
    id: string,
    data: Partial<ICategory>
): Promise<ICategory | null> {
    return Category.findOneAndUpdate(
        { _id: id, tenantId, isDeleted: false },
        { $set: data },
        { new: true }
    );
}

export async function toggleCategoryStatus(tenantId: string, id: string): Promise<ICategory | null> {
    const category = await Category.findOne({ _id: id, tenantId, isDeleted: false });
    if (!category) return null;
    category.status = category.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    return category.save();
}

// --- UoMs ---
export async function createUom(tenantId: string, data: Partial<IUom>): Promise<IUom> {
    const uom = new Uom({ ...data, tenantId });
    return uom.save();
}

export async function listUoms(tenantId: string): Promise<IUom[]> {
    return Uom.find({ tenantId, isDeleted: false }).sort({ name: 1 });
}

export async function updateUom(
    tenantId: string,
    id: string,
    data: Partial<IUom>
): Promise<IUom | null> {
    return Uom.findOneAndUpdate(
        { _id: id, tenantId, isDeleted: false },
        { $set: data },
        { new: true }
    );
}

export async function toggleUomStatus(tenantId: string, id: string): Promise<IUom | null> {
    const uom = await Uom.findOne({ _id: id, tenantId, isDeleted: false });
    if (!uom) return null;
    uom.status = uom.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    return uom.save();
}

// --- Products ---
export async function createProduct(tenantId: string, data: Partial<IProduct>): Promise<IProduct> {
    let code = data.code;
    if (!code) {
        code = await getNextSequence(tenantId, 'PRD');
    }

    const product = new Product({ ...data, tenantId, code });
    return product.save();
}

export async function listProducts(tenantId: string, filters: ProductListFilters = {}): Promise<IProduct[]> {
    const query: Record<string, unknown> = { tenantId, isDeleted: false };
    if (filters.search) {
        const searchRegex = { $regex: filters.search, $options: 'i' };
        query.$or = [{ code: searchRegex }, { name: searchRegex }];
    }
    if (filters.type && filters.type !== 'ALL') query.type = filters.type;
    if (filters.categoryId && filters.categoryId !== 'ALL') query.categoryId = filters.categoryId;
    if (filters.status && filters.status !== 'ALL') query.status = filters.status;

    return Product.find(query).sort({ createdAt: -1 });
}

export async function importProducts(tenantId: string, rows: ImportProductRowDTO[]) {
    const categories = await Category.find({ tenantId, isDeleted: false });
    const uoms = await Uom.find({ tenantId, isDeleted: false });

    const categoryMap = new Map<string, CategoryLookup>(
        categories.map((category) => [
            normalizeLookup(category.name),
            { _id: category._id, name: category.name },
        ])
    );
    const uomMap = new Map(
        uoms.flatMap((uom) => [
            [normalizeLookup(uom.name), { _id: uom._id, name: uom.name, symbol: uom.symbol }] as const,
            [normalizeLookup(uom.symbol), { _id: uom._id, name: uom.name, symbol: uom.symbol }] as const,
        ])
    );

    let created = 0;
    let updated = 0;

    for (const row of rows) {
        let category = categoryMap.get(normalizeLookup(row.category));
        if (!category) {
            const createdCategory = await createCategory(tenantId, { name: row.category, status: 'ACTIVE' });
            category = { _id: createdCategory._id, name: createdCategory.name };
            categoryMap.set(normalizeLookup(category.name), category);
        }

        let uom = uomMap.get(normalizeLookup(row.uom));
        if (!uom) {
            const symbol = row.uomSymbol?.trim() || row.uom.trim().slice(0, 5).toUpperCase();
            const createdUom = await createUom(tenantId, { name: row.uom, symbol, status: 'ACTIVE' });
            uom = { _id: createdUom._id, name: createdUom.name, symbol: createdUom.symbol };
            uomMap.set(normalizeLookup(uom.name), uom);
            uomMap.set(normalizeLookup(uom.symbol), uom);
        }

        const inventoryTracked = row.type === 'SERVICE'
            ? false
            : row.inventoryTracked ?? true;
        const costPrice = row.type === 'SERVICE'
            ? 0
            : row.costPrice ?? 0;

        const payload: Partial<IProduct> = {
            code: row.code?.trim() || undefined,
            name: row.name.trim(),
            type: row.type,
            categoryId: category._id as IProduct['categoryId'],
            uomId: uom._id as IProduct['uomId'],
            unitPrice: row.unitPrice,
            costPrice,
            vatRate: row.vatRate ?? 5,
            inventoryTracked,
            status: row.status ?? 'ACTIVE',
        };

        const existing = row.code
            ? await Product.findOne({ tenantId, code: row.code.trim(), isDeleted: false })
            : await Product.findOne({ tenantId, name: row.name.trim(), isDeleted: false });

        if (existing) {
            await Product.findByIdAndUpdate(existing._id, { $set: payload });
            updated += 1;
        } else {
            await createProduct(tenantId, payload);
            created += 1;
        }
    }

    return {
        total: rows.length,
        created,
        updated,
    };
}

export async function updateProduct(
    tenantId: string,
    id: string,
    data: Partial<IProduct>
): Promise<IProduct | null> {
    // Prevent updating code if it's auto-generated, or restrict it?
    // Usually code is immutable, but we can allow it if needed.
    // Ideally we shouldn't allow changing tenantId.
    const { tenantId: _, code, ...rest } = data; // Prevent updating tenantId
    return Product.findOneAndUpdate(
        { _id: id, tenantId, isDeleted: false },
        { $set: rest },
        { new: true }
    );
}

export async function toggleProductStatus(tenantId: string, id: string): Promise<IProduct | null> {
    const product = await Product.findOne({ _id: id, tenantId, isDeleted: false });
    if (!product) return null;
    product.status = product.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    return product.save();
}

export async function softDeleteProduct(tenantId: string, id: string): Promise<IProduct | null> {
    // Check if used in transactions? (Future/Optional)
    return Product.findOneAndUpdate(
        { _id: id, tenantId, isDeleted: false },
        { $set: { isDeleted: true } },
        { new: true }
    );
}

// --- Stock Management ---

export interface StockItemWithProduct {
    id: string;
    productId: string;
    code: string;
    name: string;
    type: 'PRODUCT' | 'SERVICE';
    category: string;
    quantityOnHand: number;
    reservedQuantity: number;
    status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
}

interface StockListFilters {
    search?: string;
    categoryId?: string;
    status?: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'ALL';
    lowStockOnly?: boolean;
}

function calculateStockStatus(qty: number): 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' {
    if (qty <= 0) return 'OUT_OF_STOCK';
    if (qty < 10) return 'LOW_STOCK';
    return 'IN_STOCK';
}

export async function listStock(tenantId: string, filters: StockListFilters = {}): Promise<StockItemWithProduct[]> {
    // Build product query
    const productQuery: Record<string, unknown> = { tenantId, isDeleted: false, type: 'PRODUCT' }; // Only products, not services

    if (filters.search) {
        const searchRegex = { $regex: filters.search, $options: 'i' };
        productQuery.$or = [{ code: searchRegex }, { name: searchRegex }];
    }

    if (filters.categoryId && filters.categoryId !== 'ALL') {
        productQuery.categoryId = filters.categoryId;
    }

    // Get products with their stock info
    const products = await Product.find(productQuery)
        .populate('categoryId', 'name')
        .sort({ code: 1 });

    const result: StockItemWithProduct[] = [];

    for (const product of products) {
        // Get or create stock record
        let stock = await Stock.findOne({ tenantId, productId: product._id, isDeleted: false });

        if (!stock) {
            // Initialize stock if not exists
            stock = new Stock({
                tenantId,
                productId: product._id,
                quantityOnHand: 0,
                reservedQuantity: 0,
            });
            await stock.save();
        }

        const status = calculateStockStatus(stock.quantityOnHand);

        // Apply low stock filter if requested
        if (filters.lowStockOnly && status === 'IN_STOCK') {
            continue;
        }

        if (filters.status && filters.status !== 'ALL' && status !== filters.status) {
            continue;
        }

        const categoryName = (product.categoryId as { name?: string } | null)?.name || 'Uncategorized';

        result.push({
            id: stock._id.toString(),
            productId: product._id.toString(),
            code: product.code,
            name: product.name,
            type: product.type,
            category: categoryName,
            quantityOnHand: stock.quantityOnHand,
            reservedQuantity: stock.reservedQuantity,
            status,
        });
    }

    return result;
}

export async function adjustStock(
    tenantId: string,
    stockId: string,
    type: 'INCREASE' | 'DECREASE',
    quantity: number,
    reason: string
): Promise<IStock | null> {
    const stock = await Stock.findOne({ _id: stockId, tenantId, isDeleted: false });
    if (!stock) return null;

    const adjustment = type === 'INCREASE' ? quantity : -quantity;
    const newQty = Math.max(0, stock.quantityOnHand + adjustment);

    stock.quantityOnHand = newQty;


    return stock.save();
}

export async function getStockByProduct(tenantId: string, productId: string): Promise<IStock | null> {
    let stock = await Stock.findOne({ tenantId, productId, isDeleted: false });

    if (!stock) {
        // Auto-create stock record if product exists
        const product = await Product.findOne({ _id: productId, tenantId, isDeleted: false });
        if (!product) return null;

        stock = new Stock({
            tenantId,
            productId,
            quantityOnHand: 0,
            reservedQuantity: 0,
        });
        await stock.save();
    }

    return stock;
}
