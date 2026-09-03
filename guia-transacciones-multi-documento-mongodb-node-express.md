# Guía Técnica: Transacciones Multi-Documento (ACID) en MongoDB con Node.js y Express

## 📚 Introducción

En el desarrollo de sistemas transaccionales, una sola acción del usuario puede requerir modificar información almacenada en varias colecciones de MongoDB.

Un ejemplo clásico es una **venta en una tienda en línea**:

1. Verificar que el producto existe.
2. Verificar que existe suficiente stock.
3. Descontar la cantidad vendida del inventario.
4. Registrar la venta.
5. Confirmar todos los cambios.

El problema aparece si una de estas operaciones falla.

```text
Producto encontrado
       ↓
Stock suficiente
       ↓
Descontar stock     ✅
       ↓
Registrar venta     ❌ ERROR
```

Sin una transacción, podríamos terminar con un sistema inconsistente:

```text
Stock: 8 unidades
Venta registrada: ❌
```

El producto perdió unidades, pero la venta no quedó registrada.

Con una **transacción ACID**, MongoDB puede garantizar que todas las operaciones se confirmen juntas o que ninguna quede aplicada.

---

# 🧠 1. Conceptos Fundamentales

## 1.1 ¿Qué es una transacción?

Una **transacción** es un conjunto de operaciones que deben tratarse como una sola unidad lógica.

```text
INICIO
   │
   ├── Operación 1
   ├── Operación 2
   ├── Operación 3
   └── Operación 4
        │
        ├── Todo correcto → COMMIT
        │
        └── Algún error → ROLLBACK
```

En MongoDB, una transacción permite realizar varias operaciones sobre uno o varios documentos y colecciones y posteriormente:

- Confirmarlas mediante `commitTransaction()`.
- Revertirlas mediante `abortTransaction()`.

---

# 🔐 2. ¿Qué significa ACID?

ACID representa cuatro propiedades fundamentales de las transacciones.

## A — Atomicidad

La operación se ejecuta completamente o no se aplica.

> **Todo o nada.**

```text
Descontar stock       ✅
Registrar venta       ❌

Resultado:

Descontar stock       ↩️ REVERSADO
Registrar venta       ↩️ REVERSADO
```

Si registrar la venta falla, MongoDB revierte también el descuento del stock.

## C — Consistencia

La base de datos debe pasar de un estado válido a otro estado válido.

Por ejemplo:

```text
Antes:

Producto
stock = 10

Venta
no registrada
```

Después de una venta de 2 unidades:

```text
Producto
stock = 8

Venta
registrada por 2 unidades
```

## I — Aislamiento

Las operaciones concurrentes deben manejarse de manera que una transacción no produzca resultados incorrectos debido a otra operación simultánea.

Por ejemplo:

```text
Stock disponible: 5

Cliente A → compra 4
Cliente B → compra 4
```

El sistema debe controlar correctamente estas operaciones concurrentes para evitar que ambos procesos consuman el mismo stock de forma incorrecta.

## D — Durabilidad

Una vez que MongoDB confirma una transacción mediante `commitTransaction()`, los cambios quedan persistidos.

```text
Transacción
    │
    ↓
COMMIT
    │
    ↓
Cambios confirmados
    │
    ↓
Persistencia
```

---

# 🧩 3. ¿Qué es `MongoClient`?

Cuando trabajamos con el driver oficial de MongoDB para Node.js utilizamos `MongoClient`.

```javascript
const { MongoClient } = require('mongodb');

const client = new MongoClient(process.env.MONGODB_URI);
```

El `client` representa nuestra conexión con MongoDB.

Las sesiones se crean utilizando:

```javascript
const session = client.startSession();
```

Por eso nuestra configuración exportará tanto:

```javascript
conectarDB
```

como:

```javascript
client
```

---

# 🏗️ 4. Estructura del proyecto

```text
mi-tienda/
│
├── src/
│   ├── config/
│   │   └── database.js
│   │
│   ├── controllers/
│   │   └── venta.controller.js
│   │
│   ├── routes/
│   │   ├── producto.routes.js
│   │   └── venta.routes.js
│   │
│   └── server.js
│
├── .env
├── package.json
└── README.md
```

---

# ⚙️ 5. Configuración de la conexión

Archivo:

```text
src/config/database.js
```

```javascript
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Creamos la instancia del cliente con la URI del archivo .env
const client = new MongoClient(process.env.MONGODB_URI);

let db;

async function conectarDB() {
    if (db) return db;

    try {
        await client.connect();

        db = client.db(process.env.DB_NAME);

        console.log('✅ Conectado exitosamente a MongoDB');

        return db;

    } catch (error) {

        console.error(
            '❌ Error al conectar a MongoDB:',
            error
        );

        process.exit(1);
    }
}

// Exportamos la función y el cliente
module.exports = {
    conectarDB,
    client
};
```

## 🔎 Explicación

Creamos el cliente:

```javascript
const client = new MongoClient(process.env.MONGODB_URI);
```

Posteriormente establecemos la conexión:

```javascript
await client.connect();
```

Seleccionamos la base de datos:

```javascript
db = client.db(process.env.DB_NAME);
```

Finalmente exportamos ambos:

```javascript
module.exports = {
    conectarDB,
    client
};
```

---

# 🌐 6. Variables de entorno

Archivo:

```text
.env
```

Ejemplo:

```env
MONGODB_URI=mongodb://localhost:27017
DB_NAME=mi_tienda
PORT=3000
```

Para MongoDB Atlas podría utilizarse una URI proporcionada por Atlas:

```env
MONGODB_URI=mongodb+srv://usuario:password@cluster.mongodb.net/
DB_NAME=mi_tienda
PORT=3000
```

> ⚠️ **Importante:** nunca publiques credenciales reales de MongoDB en GitHub o en archivos que vayan a compartirse.

---

# 💰 7. Controlador de ventas

Archivo:

```text
src/controllers/venta.controller.js
```

Este controlador será responsable de:

1. Crear una sesión.
2. Iniciar una transacción.
3. Buscar el producto.
4. Verificar el stock.
5. Descontar el stock.
6. Registrar la venta.
7. Confirmar la transacción.
8. Revertirla si ocurre algún error.

```javascript
const {
    conectarDB,
    client
} = require('../config/database');

const {
    ObjectId
} = require('mongodb');

const realizarVenta = async (req, res) => {

    // 1. INICIAR SESIÓN
    const session = client.startSession();

    try {

        // 2. INICIAR TRANSACCIÓN
        session.startTransaction();

        const db = await conectarDB();

        const {
            productoId,
            cantidad
        } = req.body;

        // Validaciones básicas
        if (
            !ObjectId.isValid(productoId) ||
            !cantidad ||
            cantidad <= 0
        ) {

            await session.abortTransaction();
            session.endSession();

            return res.status(400).json({
                error: 'Datos de venta inválidos'
            });
        }

        // 3. BUSCAR PRODUCTO
        const producto = await db
            .collection('productos')
            .findOne(
                {
                    _id: new ObjectId(productoId)
                },
                {
                    session
                }
            );

        if (!producto) {

            await session.abortTransaction();
            session.endSession();

            return res.status(404).json({
                error: 'Producto no encontrado'
            });
        }

        // Validar stock disponible
        if (producto.stock < cantidad) {

            await session.abortTransaction();
            session.endSession();

            return res.status(400).json({
                error: `Stock insuficiente. Disponible: ${producto.stock}`
            });
        }

        // 4. ACTUALIZAR STOCK
        await db
            .collection('productos')
            .updateOne(
                {
                    _id: new ObjectId(productoId)
                },
                {
                    $inc: {
                        stock: -cantidad
                    }
                },
                {
                    session
                }
            );

        // 5. CREAR DOCUMENTO DE VENTA
        const nuevaVenta = {

            productoId:
                new ObjectId(productoId),

            nombreProducto:
                producto.nombre,

            cantidadVendida:
                cantidad,

            precioUnitario:
                producto.precio,

            total:
                producto.precio * cantidad,

            fecha:
                new Date()
        };

        // 6. REGISTRAR LA VENTA
        const resultadoVenta =
            await db
                .collection('ventas')
                .insertOne(
                    nuevaVenta,
                    {
                        session
                    }
                );

        // 7. CONFIRMAR TRANSACCIÓN
        await session.commitTransaction();

        session.endSession();

        return res.status(201).json({

            mensaje:
                '¡Venta registrada con éxito bajo control ACID!',

            ventaId:
                resultadoVenta.insertedId
        });

    } catch (error) {

        // 8. REVERTIR TRANSACCIÓN
        try {

            await session.abortTransaction();

        } catch (abortError) {

            console.error(
                'Error al revertir la transacción:',
                abortError
            );
        }

        session.endSession();

        console.error(
            'Error crítico en la transacción de venta:',
            error
        );

        return res.status(500).json({

            error:
                'Error al procesar la venta. ' +
                'Transacción revertida automáticamente.'
        });
    }
};

module.exports = {
    realizarVenta
};
```

---

# 🔍 8. Explicación del controlador

## 8.1 Crear una sesión

```javascript
const session = client.startSession();
```

Una sesión permite asociar nuestras operaciones con una transacción.

Podemos imaginarla como un identificador que le dice a MongoDB:

> "Estas operaciones forman parte del mismo proceso transaccional."

---

# ▶️ 9. Iniciar la transacción

```javascript
session.startTransaction();
```

A partir de este punto, las operaciones que utilicen:

```javascript
{
    session
}
```

formarán parte de la transacción.

---

# 🔎 10. Buscar el producto

```javascript
const producto = await db
    .collection('productos')
    .findOne(
        {
            _id: new ObjectId(productoId)
        },
        {
            session
        }
    );
```

El detalle importante es:

```javascript
{
    session
}
```

Esto hace que la operación esté asociada a nuestra sesión.

---

# 📦 11. Validar el stock

Supongamos:

```text
Producto:
Laptop

Stock:
10

Cantidad solicitada:
3
```

La condición:

```javascript
if (producto.stock < cantidad)
```

comprueba:

```text
10 < 3 → false
```

Por lo tanto, la operación puede continuar.

Si tenemos:

```text
Stock:
2

Cantidad solicitada:
5
```

entonces:

```text
2 < 5 → true
```

La venta se rechaza.

---

# ➖ 12. Descontar el stock

Utilizamos:

```javascript
$inc
```

de esta manera:

```javascript
{
    $inc: {
        stock: -cantidad
    }
}
```

Si tenemos:

```text
stock = 10
cantidad = 3
```

MongoDB realiza:

```text
10 + (-3) = 7
```

Resultado:

```text
stock = 7
```

La operación está asociada a la transacción:

```javascript
{
    session
}
```

---

# 🧾 13. Registrar la venta

Creamos un documento:

```javascript
const nuevaVenta = {

    productoId:
        new ObjectId(productoId),

    nombreProducto:
        producto.nombre,

    cantidadVendida:
        cantidad,

    precioUnitario:
        producto.precio,

    total:
        producto.precio * cantidad,

    fecha:
        new Date()
};
```

Ejemplo:

```json
{
    "productoId": "65b1c2...",
    "nombreProducto": "Laptop",
    "cantidadVendida": 2,
    "precioUnitario": 1200,
    "total": 2400,
    "fecha": "2026-08-21T..."
}
```

Después lo insertamos:

```javascript
await db
    .collection('ventas')
    .insertOne(
        nuevaVenta,
        {
            session
        }
    );
```

---

# ✅ 14. Confirmar la transacción

Cuando todas las operaciones fueron exitosas:

```javascript
await session.commitTransaction();
```

Conceptualmente:

```text
Buscar producto      ✅
Validar stock        ✅
Actualizar stock     ✅
Registrar venta      ✅
                     │
                     ↓
                   COMMIT
                     │
                     ↓
              CAMBIOS CONFIRMADOS
```

---

# ↩️ 15. Revertir la transacción

Si ocurre una excepción:

```javascript
catch (error) {
```

ejecutamos:

```javascript
await session.abortTransaction();
```

Esto provoca el rollback.

Ejemplo:

```text
Stock inicial: 10

Descontar stock:
10 → 8       ✅

Registrar venta:
ERROR        ❌

abortTransaction()
       ↓

Stock vuelve a 10
```

La venta tampoco queda registrada.

---

# 🧹 16. Finalizar la sesión

Una vez terminada la transacción debemos cerrar la sesión:

```javascript
session.endSession();
```

Esto se realiza tanto después de un `commit` como después de un `abort`.

---

# 🛣️ 17. Crear la ruta de ventas

Archivo:

```text
src/routes/venta.routes.js
```

```javascript
const {
    Router
} = require('express');

const {
    realizarVenta
} = require('../controllers/venta.controller');

const router = Router();

// Procesar una venta
router.post(
    '/',
    realizarVenta
);

module.exports = router;
```

Esta ruta indica que:

```text
POST /api/ventas
```

ejecutará:

```javascript
realizarVenta
```

---

# 🚀 18. Registrar la ruta en Express

Archivo:

```text
src/server.js
```

```javascript
const express = require('express');

require('dotenv').config();

const productoRoutes =
    require('./routes/producto.routes');

const ventaRoutes =
    require('./routes/venta.routes');

const app = express();

const PORT =
    process.env.PORT || 3000;

// Permitir recibir JSON
app.use(express.json());

// Rutas
app.use(
    '/api/productos',
    productoRoutes
);

app.use(
    '/api/ventas',
    ventaRoutes
);

app.listen(
    PORT,
    () => {

        console.log(
            `🚀 Servidor corriendo en http://localhost:${PORT}`
        );
    }
);
```

La ruta final será:

```text
POST http://localhost:3000/api/ventas
```

---

# 🧪 19. Probar la transacción

Podemos utilizar herramientas como:

- Postman
- Thunder Client
- Insomnia
- cURL

## Endpoint

```text
POST http://localhost:3000/api/ventas
```

## Body

Seleccionar:

```text
Body → raw → JSON
```

Enviar:

```json
{
    "productoId": "65b1c2...tu_id_real...",
    "cantidad": 2
}
```

---

# 📤 20. Respuesta exitosa

Si todo funciona correctamente:

```json
{
    "mensaje": "¡Venta registrada con éxito bajo control ACID!",
    "ventaId": "66a123..."
}
```

Podemos comprobar posteriormente:

```javascript
db.productos.find()
```

y:

```javascript
db.ventas.find()
```

Deberíamos observar:

```text
productos
   ↓
stock actualizado

ventas
   ↓
nueva venta registrada
```

---

# ❌ 21. Probar un error de stock

Supongamos que tenemos:

```json
{
    "productoId": "65b1c2...",
    "cantidad": 1000
}
```

pero el producto solamente tiene:

```text
stock = 10
```

La API responderá:

```json
{
    "error": "Stock insuficiente. Disponible: 10"
}
```

Y no se registrará ninguna venta.

---

# 💥 22. ¿Qué ocurre si falla una operación?

Supongamos:

```text
Stock inicial: 10
       │
       ↓
Actualizar stock
       │
       ↓
       8
       │
       ↓
Insertar venta
       │
       X
     ERROR
       │
       ↓
abortTransaction()
       │
       ↓
Stock vuelve a 10
```

Este es uno de los principales beneficios de las transacciones.

---

# 🧩 23. ¿Por qué todas las operaciones necesitan `{ session }`?

No basta con iniciar:

```javascript
session.startTransaction();
```

También debemos asociar las operaciones a la sesión:

```javascript
findOne(
    filtro,
    { session }
);
```

```javascript
updateOne(
    filtro,
    actualizacion,
    { session }
);
```

```javascript
insertOne(
    documento,
    { session }
);
```

La idea es:

```text
Transacción
     │
     ├── findOne       { session }
     ├── updateOne     { session }
     └── insertOne     { session }
```

> 📌 **Regla práctica:** todas las operaciones que deban confirmarse o revertirse juntas deben ejecutarse utilizando la misma sesión.

---

# 🗄️ 24. Requisito: Replica Set

Las transacciones multi-documento de MongoDB requieren un entorno que soporte transacciones, como un **Replica Set**.

En MongoDB Atlas, el entorno administrado proporciona una configuración adecuada para utilizar transacciones.

En una instalación local, debemos asegurarnos de que MongoDB esté configurado con Replica Set.

> ⚠️ **Importante:** una instalación local de MongoDB ejecutándose simplemente como una instancia independiente no es suficiente para las transacciones multi-documento.

---

# 🐳 25. Ejemplo de MongoDB local con Docker

Una alternativa para realizar prácticas es ejecutar MongoDB mediante Docker con Replica Set.

Ejemplo:

```bash
docker run -d \
  --name mongodb \
  -p 27017:27017 \
  mongo:latest \
  --replSet rs0 \
  --bind_ip_all
```

Después podemos inicializar el Replica Set desde `mongosh`:

```javascript
rs.initiate()
```

Comprobar el estado:

```javascript
rs.status()
```

> ⚠️ La configuración exacta puede variar dependiendo de la versión de MongoDB y del entorno utilizado.

---

# 🌐 26. MongoDB Atlas

Otra alternativa es utilizar MongoDB Atlas.

La arquitectura sería:

```text
Node.js + Express
        │
        │ MongoDB Driver
        ↓
   MongoDB Atlas
        │
        ↓
   Base de datos
```

En este caso, la aplicación utilizará una URI similar a:

```env
MONGODB_URI=mongodb+srv://usuario:password@cluster.mongodb.net/
```

> 🔐 Nunca compartas públicamente la URI si contiene credenciales.

---

# 🔄 27. Flujo completo de una venta

```text
                CLIENTE
                   │
                   │ POST /api/ventas
                   ↓
            Express / Router
                   │
                   ↓
          realizarVenta()
                   │
                   ↓
            startSession()
                   │
                   ↓
         startTransaction()
                   │
                   ↓
          Buscar producto
                   │
             ┌─────┴─────┐
             │           │
        No existe      Existe
             │           │
             ↓           ↓
          ERROR      Validar stock
                         │
                    ┌────┴────┐
                    │         │
              Insuficiente   OK
                    │         │
                    ↓         ↓
                  ERROR   Actualizar stock
                              │
                              ↓
                        Registrar venta
                              │
                         ┌────┴────┐
                         │         │
                       ERROR      OK
                         │         │
                         ↓         ↓
                      ABORT     COMMIT
                         │         │
                         ↓         ↓
                      ROLLBACK  Confirmar
                                   │
                                   ↓
                               Respuesta
```

---

# 🎯 28. ¿Qué estamos resolviendo realmente?

Este ejemplo no solamente trata sobre MongoDB.

Estamos resolviendo un problema de **integridad de datos**.

Tenemos dos operaciones relacionadas:

```text
productos
   │
   │ actualizar stock
   ↓
stock

ventas
   │
   │ registrar operación
   ↓
venta
```

Ambas representan una única acción del negocio:

> **Realizar una venta.**

Por eso tiene sentido que ambas operaciones formen parte de la misma transacción.

---

# 📌 29. Buenas prácticas

## 29.1 Mantener las transacciones cortas

Una transacción no debería mantenerse abierta innecesariamente.

Evitar:

```text
Inicio de transacción
       ↓
Esperar al usuario
       ↓
Procesar información durante mucho tiempo
       ↓
Commit
```

Es mejor:

```text
Validaciones
     ↓
Inicio de transacción
     ↓
Operaciones necesarias
     ↓
Commit
```

## 29.2 Validar los datos recibidos

Antes de procesar:

```javascript
productoId
cantidad
```

debemos verificar que tengan un formato válido.

Por ejemplo:

```javascript
ObjectId.isValid(productoId)
```

## 29.3 No almacenar contraseñas en el código

Incorrecto:

```javascript
const uri =
    "mongodb+srv://usuario:password@cluster...";
```

Preferible:

```javascript
const client =
    new MongoClient(process.env.MONGODB_URI);
```

## 29.4 Registrar errores

Durante el desarrollo:

```javascript
console.error(error);
```

En sistemas reales podemos utilizar herramientas de logging para registrar información de forma estructurada.

---

# 🧠 30. Métodos importantes para recordar

| Método | Función |
|---|---|
| `client.startSession()` | Crear una sesión |
| `session.startTransaction()` | Iniciar una transacción |
| `{ session }` | Asociar una operación a la transacción |
| `session.commitTransaction()` | Confirmar la transacción |
| `session.abortTransaction()` | Revertir la transacción |
| `session.endSession()` | Finalizar la sesión |

---

# 🎓 31. Ejercicio práctico

Para comprobar que la transacción funciona correctamente, realiza las siguientes pruebas.

## Prueba 1 — Venta correcta

Crear un producto:

```javascript
db.productos.insertOne({
    nombre: "Laptop",
    precio: 1200,
    stock: 10
});
```

Realizar una venta de:

```json
{
    "productoId": "ID_DEL_PRODUCTO",
    "cantidad": 2
}
```

Verificar:

```javascript
db.productos.find()
```

Resultado esperado:

```text
stock = 8
```

Y:

```javascript
db.ventas.find()
```

Debe existir una nueva venta.

---

# Prueba 2 — Stock insuficiente

Intentar vender:

```json
{
    "productoId": "ID_DEL_PRODUCTO",
    "cantidad": 100
}
```

Resultado esperado:

```text
HTTP 400
```

Y:

```text
No se crea una venta.
El stock permanece igual.
```

---

# Prueba 3 — Analizar un fallo

Modifica temporalmente el código para provocar un error después de actualizar el stock y antes de insertar la venta.

Por ejemplo:

```javascript
await db.collection('productos').updateOne(
    {
        _id: new ObjectId(productoId)
    },
    {
        $inc: {
            stock: -cantidad
        }
    },
    {
        session
    }
);

// Provocar error de prueba
throw new Error('Error de prueba');
```

Después comprueba:

```javascript
db.productos.find()
```

y:

```javascript
db.ventas.find()
```

### Resultado esperado

El stock debe regresar a su valor original y la venta no debe quedar registrada.

Esto permite comprobar experimentalmente:

```text
Atomicidad
    ↓
COMMIT / ROLLBACK
```

---

# 📝 32. Preguntas de análisis

Para reforzar la práctica:

### 1. ¿Qué ocurriría si actualizamos el stock pero no utilizamos una transacción?

### 2. ¿Qué diferencia existe entre `commitTransaction()` y `abortTransaction()`?

### 3. ¿Por qué necesitamos una sesión?

### 4. ¿Qué función cumple `MongoClient`?

### 5. ¿Por qué las operaciones deben recibir `{ session }`?

### 6. ¿Qué propiedad ACID garantiza el "todo o nada"?

### 7. ¿Qué ocurre con el stock si falla el registro de la venta?

### 8. ¿Por qué MongoDB necesita un Replica Set para este escenario?

### 9. ¿Qué diferencia existe entre una operación sobre un único documento y una transacción multi-documento?

### 10. ¿Qué otros procesos de un sistema podrían beneficiarse de una transacción?

Ejemplos:

```text
Transferencias bancarias
Pedidos
Reservas
Pagos
Inventarios
Préstamos
Facturación
```

---

# 🏆 33. Resumen final

Una transacción multi-documento permite que varias operaciones de MongoDB se comporten como una sola unidad.

En nuestro ejemplo:

```text
1. Buscar producto
        ↓
2. Validar stock
        ↓
3. Descontar stock
        ↓
4. Registrar venta
        ↓
5. COMMIT
```

Si todo funciona:

```text
COMMIT
  ↓
Cambios permanentes
```

Si ocurre un error:

```text
ERROR
  ↓
ABORT
  ↓
ROLLBACK
  ↓
Cambios revertidos
```

La idea fundamental es:

> **Una venta representa una única operación de negocio, por lo que el descuento del inventario y el registro de la venta deben confirmarse o revertirse juntos.**

---

# 📚 34. Conclusión

Las transacciones ACID son especialmente útiles cuando una operación de negocio afecta varios documentos o colecciones y necesitamos garantizar que los cambios permanezcan sincronizados.

En una aplicación real, ejemplos similares aparecen en:

- 🛒 Ventas.
- 📦 Pedidos.
- 💳 Procesamiento de pagos.
- 🏦 Transferencias.
- 🎟️ Reservas.
- 📚 Préstamos.
- 🚚 Gestión de inventario.
- 👥 Procesos que actualizan múltiples entidades relacionadas.

El concepto más importante que debemos recordar es:

```text
Varias operaciones
       ↓
Una unidad de negocio
       ↓
Una transacción
       ↓
     ACID
       ↓
COMMIT o ROLLBACK
```

Así conseguimos que nuestra aplicación sea mucho más confiable y que los datos no queden en estados intermedios o inconsistentes.
