import express from 'express';
import * as controller from '../controllers/journalEntry.controller';

const router = express.Router();

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.getById);
router.patch('/:id', controller.update);
router.post('/:id/post', controller.post);
router.get('/:id/validate-fiscal', controller.validateFiscal); // Debug endpoint
router.post('/:id/reverse', controller.reverse);
router.delete('/:id', controller.remove);

export default router;
