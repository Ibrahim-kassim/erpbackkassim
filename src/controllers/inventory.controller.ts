import { Request, Response } from 'express';
import * as inventoryService from '../services/inventory.service';
import { categorySchema, uomSchema, productSchema, updateProductSchema, stockAdjustmentSchema } from '../validators/inventory.schema';
import { asyncHandler } from '../middleware/asyncHandler';

// --- Categories ---
export const createCategory = asyncHandler(async (req: Request, res: Response) => {
    const validatedData = categorySchema.safeParse(req.body);
    if (!validatedData.success) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid inputs',
            details: validatedData.error.format()
        });
        return;
    }
    const category = await inventoryService.createCategory(req.tenantId!, validatedData.data);
    res.status(201).json(category);
});

export const listCategories = asyncHandler(async (req: Request, res: Response) => {
    const categories = await inventoryService.listCategories(req.tenantId!);
    res.json(categories);
});

export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const validatedData = categorySchema.partial().safeParse(req.body); // Use partial for updates if needed, or stick to validated strict schema for PUT
    // Actually, usually PUT expects full or specific partial.
    // Let's assume partial is okay for updates here, similar to BP.
    if (!validatedData.success) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid inputs',
            details: validatedData.error.format()
        });
        return;
    }

    const category = await inventoryService.updateCategory(req.tenantId!, id, validatedData.data);
    if (!category) {
        res.status(404).json({ message: 'Category not found' });
        return;
    }
    res.json(category);
});

export const toggleCategoryStatus = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const category = await inventoryService.toggleCategoryStatus(req.tenantId!, id);
    if (!category) {
        res.status(404).json({ message: 'Category not found' });
        return;
    }
    res.json(category);
});

// --- UoMs ---
export const createUom = asyncHandler(async (req: Request, res: Response) => {
    const validatedData = uomSchema.safeParse(req.body);
    if (!validatedData.success) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid inputs',
            details: validatedData.error.format()
        });
        return;
    }
    const uom = await inventoryService.createUom(req.tenantId!, validatedData.data);
    res.status(201).json(uom);
});

export const listUoms = asyncHandler(async (req: Request, res: Response) => {
    const uoms = await inventoryService.listUoms(req.tenantId!);
    res.json(uoms);
});

export const updateUom = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const validatedData = uomSchema.partial().safeParse(req.body);
    if (!validatedData.success) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid inputs',
            details: validatedData.error.format()
        });
        return;
    }
    const uom = await inventoryService.updateUom(req.tenantId!, id, validatedData.data);
    if (!uom) {
        res.status(404).json({ message: 'UoM not found' });
        return;
    }
    res.json(uom);
});

export const toggleUomStatus = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const uom = await inventoryService.toggleUomStatus(req.tenantId!, id);
    if (!uom) {
        res.status(404).json({ message: 'UoM not found' });
        return;
    }
    res.json(uom);
});

// --- Products ---
export const createProduct = asyncHandler(async (req: Request, res: Response) => {
    const validatedData = productSchema.safeParse(req.body);
    if (!validatedData.success) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid inputs',
            details: validatedData.error.format()
        });
        return;
    }
    const product = await inventoryService.createProduct(req.tenantId!, validatedData.data as any);
    res.status(201).json(product);
});

export const listProducts = asyncHandler(async (req: Request, res: Response) => {
    const products = await inventoryService.listProducts(req.tenantId!, req.query);
    res.json(products);
});

export const updateProduct = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const validatedData = updateProductSchema.safeParse(req.body);
    if (!validatedData.success) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid inputs',
            details: validatedData.error.format()
        });
        return;
    }
    const product = await inventoryService.updateProduct(req.tenantId!, id, validatedData.data as any);
    if (!product) {
        res.status(404).json({ message: 'Product not found' });
        return;
    }
    res.json(product);
});

export const toggleProductStatus = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const product = await inventoryService.toggleProductStatus(req.tenantId!, id);
    if (!product) {
        res.status(404).json({ message: 'Product not found' });
        return;
    }
    res.json(product);
});

export const deleteProduct = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const product = await inventoryService.softDeleteProduct(req.tenantId!, id);
    if (!product) {
        res.status(404).json({ message: 'Product not found' });
        return;
    }
    res.json({ message: 'Product deleted successfully' });
});

// --- Stock Management ---
export const listStock = asyncHandler(async (req: Request, res: Response) => {
    const filters = {
        search: req.query.search as string,
        categoryId: req.query.categoryId as string,
        lowStockOnly: req.query.lowStockOnly === 'true',
    };
    const stock = await inventoryService.listStock(req.tenantId!, filters);
    res.json({ data: stock });
});

export const adjustStock = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params; // Stock ID
    const validatedData = stockAdjustmentSchema.safeParse(req.body);

    if (!validatedData.success) {
        res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Invalid inputs',
            details: validatedData.error.format()
        });
        return;
    }

    const { type, quantity, reason } = validatedData.data;
    const stock = await inventoryService.adjustStock(req.tenantId!, id, type, quantity, reason);

    if (!stock) {
        res.status(404).json({ message: 'Stock record not found' });
        return;
    }

    res.json({ data: stock });
});
