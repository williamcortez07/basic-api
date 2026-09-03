const {Router} = require('express');
const { getProductos, getProductoById,new_bulk, createProducto, createProductos, updateProducto,deleteProducto } = require('../controllers/productos.controller');


const router = Router();

router.get('/productos', getProductos);
router.get('/productos/:id', getProductoById);
router.post('/productos', createProducto);
router.post('/productos/bulk', createProductos);
router.put('/productos/:id', updateProducto);
router.delete('/productos/:id', deleteProducto);
router.get('/new_bulk', new_bulk);
module.exports = router;