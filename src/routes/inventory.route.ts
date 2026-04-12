import { Router } from 'express';
import * as inventoryController from '../controllers/inventory.controller';
import { productsServicesRateLimiter } from '../middleware/productsServicesRateLimiter';
import { stockOverviewRateLimiter } from '../middleware/stockOverviewRateLimiter';
const router = Router();

router.use('/products', productsServicesRateLimiter);
router.use('/categories', productsServicesRateLimiter);
router.use('/uoms', productsServicesRateLimiter);
router.use('/stock', stockOverviewRateLimiter);

// --- Products ---
router.post('/products', inventoryController.createProduct);
router.get('/products', inventoryController.listProducts);
router.post('/products/import', inventoryController.importProducts);
router.put('/products/:id', inventoryController.updateProduct);
router.patch('/products/:id/status', inventoryController.toggleProductStatus);
router.delete('/products/:id', inventoryController.deleteProduct);

// --- Categories ---
router.post('/categories', inventoryController.createCategory);
router.get('/categories', inventoryController.listCategories);
router.put('/categories/:id', inventoryController.updateCategory);
router.patch('/categories/:id/status', inventoryController.toggleCategoryStatus);

// --- UoMs ---
router.post('/uoms', inventoryController.createUom);
router.get('/uoms', inventoryController.listUoms);
router.put('/uoms/:id', inventoryController.updateUom);
router.patch('/uoms/:id/status', inventoryController.toggleUomStatus);

// --- Stock ---
router.get('/stock', inventoryController.listStock);
router.post('/stock/:id/adjust', inventoryController.adjustStock);

export default router;
