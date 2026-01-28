import { Router } from 'express';
import { checkIntegrity } from '../controllers/fiscal.controller';

const router = Router();

router.get('/integrity/journal-entries-fiscal', checkIntegrity);

export default router;
