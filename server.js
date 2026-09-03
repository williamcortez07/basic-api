const express = require('express');
require('dotenv').config();

const productosRoutes = require('./src/routes/productos.routes');
const categoriasRoutes = require('./src/routes/categorias.routes');
const ventaRoutes = require('./src/routes/venta.routes');
const app = express();
const port = 3000;

app.use(express.json());

app.use('/api', productosRoutes);
app.use('/api', categoriasRoutes);
app.use('/api/ventas',ventaRoutes);

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});