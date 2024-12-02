const { PrismaClient } = require("@prisma/client");
const express = require("express");
const multer = require("multer");
const cors = require('cors');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
require("dotenv").config();

const prisma = new PrismaClient();
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// Configuración del cliente de S3
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Endpoint: Autenticación con Google
app.post("/auth/google", async (req, res) => {
  try {
    const { email, nombre, image } = req.body;

    if (!email || !nombre) {
      return res.status(400).json({ error: "El email y el nombre son obligatorios." });
    }

    // Buscar usuario por email
    let usuario = await prisma.usuario.findUnique({
      where: { email },
    });

    // Si no existe, registrar un nuevo usuario
    if (!usuario) {
      usuario = await prisma.usuario.create({
        data: {
          email,
          nombre,
          image: image || null, // Image opcional
          carrera: "Sin definir", // Valor predeterminado
        },
      });
    }

    return res.status(200).json({
      message: "Inicio de sesión exitoso",
      usuario,
    });
  } catch (error) {
    console.error("Error en /auth/google:", error.message);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
});

// Endpoint: Obtener tipos de trámites
app.get("/api/tipos-tramites", async (req, res) => {
  try {
    const tipos = await prisma.tramites.groupBy({
      by: ["tipo"],
    });

    if (!tipos.length) {
      return res.status(404).json({ error: "No se encontraron tipos de trámites." });
    }

    res.json(tipos.map((t) => t.tipo));
  } catch (error) {
    console.error("Error obteniendo tipos de trámites:", error.message);
    return res.status(500).json({ error: "Error obteniendo tipos de trámites." });
  }
});

// Endpoint: Obtener trámites según tipo
app.get("/api/tramites/:tipo", async (req, res) => {
  const { tipo } = req.params;

  if (!tipo) {
    return res.status(400).json({ error: "El tipo de trámite es obligatorio." });
  }

  try {
    const tramites = await prisma.tramites.findMany({
      where: { tipo },
    });

    if (!tramites.length) {
      return res.status(404).json({ error: "No se encontraron trámites para este tipo." });
    }

    res.json(tramites);
  } catch (error) {
    console.error("Error obteniendo trámites:", error.message);
    return res.status(500).json({ error: "Error obteniendo trámites." });
  }
});

// Endpoint: Registrar trámite
app.post("/api/registrar-tramite", async (req, res) => {
  const { idUsuario, idTramite, documentos, adicional, estado } = req.body;

  if (!idUsuario || !idTramite) {
    return res.status(400).json({
      error: "Los campos 'idUsuario' e 'idTramite' son obligatorios.",
    });
  }

  try {
    const tramiteRealizado = await prisma.tramitesRealizados.create({
      data: {
        idUsuario,
        idTramite,
        documentos: documentos || [],
        adicional: adicional || "",
        estado: estado || "pendiente",
        fechas: new Date(),
      },
    });

    res.status(201).json(tramiteRealizado);
  } catch (error) {
    console.error("Error registrando trámite:", error.message);
    return res.status(500).json({ error: "Error registrando trámite." });
  }
});

// Endpoint: Obtener detalles de un trámite por ID
app.get("/api/tramites/:id/details", async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: "El ID del trámite es obligatorio." });
  }

  try {
    // Buscar trámite por ID
    const tramite = await prisma.tramites.findUnique({
      where: { id },
    });

    if (!tramite) {
      return res.status(404).json({ error: "Trámite no encontrado." });
    }

    // Respuesta con los detalles del trámite
    res.json({
      id: tramite.id,
      nombre: tramite.nombre,
      tipo: tramite.tipo,
      costo: tramite.costo,
      requisitos: tramite.requisitos,
      descripcion: tramite.descripcion,
    });
  } catch (error) {
    console.error("Error obteniendo detalles del trámite:", error.message);
    return res.status(500).json({ error: "Error obteniendo detalles del trámite." });
  }
});

// Endpoint para subir archivos a S3
app.post("/api/upload", upload.single("file"), async (req, res) => {
  console.log("Archivo recibido:", req.file);
  try {
    // Validar que el archivo exista
    if (!req.file) {
      return res.status(400).json({ error: "No se ha proporcionado ningún archivo." });
    }

    // Generar un nombre único para el archivo
    // const fileName = `${crypto.randomUUID()}${path.extname(req.file.originalname)}`;
    const fileName = `${Date.now()}${path.extname(req.file.originalname)}`;


    // Configuración del archivo a subir
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME, // Nombre del bucket
      Key: fileName, // Nombre del archivo en S3
      Body: req.file.buffer, // Buffer del archivo
      ContentType: req.file.mimetype, // Tipo MIME
    };

    // Subir el archivo a S3
    await s3.send(new PutObjectCommand(params));

    // Construir la URL del archivo
    const fileUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

    // Responder con la URL del archivo
    res.status(200).json({ message: "Archivo subido correctamente", fileUrl });
  } catch (error) {
    console.error("Error al subir archivo a S3:", error);
    res.status(500).json({ error: "Error al subir el archivo." + error });
  }
});

// Obtener tipos de servicios
app.get('/api/tipos-servicios', async (req, res) => {
  try {
    // Recuperar todos los servicios y sus tipos
    const servicios = await prisma.servicios.findMany({
      select: { tipo: true }, // Obtener solo el campo 'tipo'
    });

    if (!servicios || servicios.length === 0) {
      return res.status(404).json({ error: 'No se encontraron tipos de servicios.' });
    }

    // Extraer los tipos únicos
    const tiposUnicos = [...new Set(servicios.map((s) => s.tipo))];

    res.json(tiposUnicos);
  } catch (error) {
    console.error('Error obteniendo tipos de servicios:', error.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

app.get('/test', (req, res) => {
  res.json({ message: 'El servidor está funcionando' });
});

// Obtener servicios según tipo
app.get('/api/servicios/:tipo', async (req, res) => {
  const { tipo } = req.params;

  try {
    const servicios = await prisma.servicios.findMany({
      where: { tipo },
      select: { id: true, nombre: true, tipo: true },
    });

    if (!servicios.length) {
      return res.status(404).json({ error: 'No se encontraron servicios.' });
    }

    res.json(servicios);
  } catch (error) {
    console.error('Error obteniendo servicios:', error.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Registrar solicitud de servicio
app.post('/api/registrar-solicitud', async (req, res) => {
  const { idUsuario, idServicio, horarioElegido, estado } = req.body;

  try {
    const nuevaSolicitud = await prisma.serviciosUtilizados.create({
      data: {
        idUsuario,
        idServicio,
        horarioElegido: new Date(horarioElegido),
        estado: estado || 'pendiente',
        fechaRegistro: new Date(),
      },
    });

    res.status(201).json(nuevaSolicitud);
  } catch (error) {
    console.error('Error registrando solicitud:', error.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});


// Manejo global de errores para rutas no definidas
app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada." });
});

// Inicializar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
